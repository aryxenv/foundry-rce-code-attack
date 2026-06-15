"""
Compatibility patch for Agent Framework Foundry hosting responses.

The refreshed `agent-framework-foundry-hosting` ResponsesHostServer currently
logs unsupported `hosted_file` content from Foundry Code Interpreter instead
of surfacing it to the hosted-agent UI. This patch keeps the secure artifact
delivery path: download generated image files with managed identity, upload
them to private blob storage, and emit a short-lived Chart URL as assistant
text.
"""

from __future__ import annotations

import os
import re
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator, Awaitable, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from agent_framework import Content
from azure.core.exceptions import AzureError
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobSasPermissions, BlobServiceClient, ContentSettings, generate_blob_sas

_PATCH_MARKER = "_contoso_hosted_file_response_patch"
_FOUNDRY_FILES_API_VERSION = "2025-05-15-preview"
_TOKEN_SCOPE = "https://ai.azure.com/.default"
_MAX_HOSTED_FILE_BYTES = 5_000_000
_DOWNLOAD_ATTEMPTS = 12
_DOWNLOAD_RETRY_DELAY_SECONDS = 2
_SANDBOX_MARKDOWN_LINK_PATTERN = re.compile(r"\s*\[[^\]]+\]\(sandbox:/mnt/data/[^)]+\)")
_SANDBOX_URI_PATTERN = re.compile(r"sandbox:/mnt/data/\S+")
_STORAGE_ACCOUNT = os.getenv("CHART_STORAGE_ACCOUNT")
_STORAGE_CONTAINER = os.getenv("CHART_STORAGE_CONTAINER", "chart-uploads")
_SAS_TTL = timedelta(hours=1)
_credential: DefaultAzureCredential | None = None


def _log(msg: str) -> None:
    """Unbuffered stderr logging, matching the [TOOL] convention used in tools.py."""
    print(f"[TOOL] {msg}", file=sys.stderr, flush=True)


def _hosted_file_url(file_id: str) -> str | None:
    project_endpoint = (
        os.getenv("FOUNDRY_PROJECT_ENDPOINT")
        or os.getenv("PROJECT_ENDPOINT")
        or os.getenv("AZURE_AI_PROJECT_ENDPOINT")
        or os.getenv("AZURE_AIPROJECT_ENDPOINT")
    )
    if not project_endpoint:
        return None
    safe_file_id = quote(file_id, safe="")
    return f"{project_endpoint.rstrip('/')}/files/{safe_file_id}/content?api-version={_FOUNDRY_FILES_API_VERSION}"


def _get_credential() -> DefaultAzureCredential:
    global _credential
    if _credential is None:
        _credential = DefaultAzureCredential()
    return _credential


def _detect_image_media_type(data: bytes, content_type: str | None) -> str | None:
    normalized = (content_type or "").split(";", maxsplit=1)[0].strip().lower()
    if normalized.startswith("image/"):
        return normalized
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _image_extension(media_type: str) -> str:
    return {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
    }.get(media_type, "img")


def _download_hosted_file(file_id: str) -> tuple[bytes, str] | None:
    file_url = _hosted_file_url(file_id)
    if not file_url:
        return None

    data: bytes | None = None
    content_type: str | None = None
    token = _get_credential().get_token(_TOKEN_SCOPE).token
    for attempt in range(1, _DOWNLOAD_ATTEMPTS + 1):
        try:
            request = Request(file_url, headers={"Authorization": f"Bearer {token}"})
            with urlopen(request, timeout=30) as response:  # nosec B310 - URL is the configured Foundry project endpoint.
                data = response.read(_MAX_HOSTED_FILE_BYTES + 1)
                content_type = response.headers.get("Content-Type")
                break
        except HTTPError as exc:
            if exc.code == 404 and attempt < _DOWNLOAD_ATTEMPTS:
                _log(
                    f"Code Interpreter hosted file {file_id} is not available yet; "
                    f"retrying download ({attempt}/{_DOWNLOAD_ATTEMPTS})"
                )
                time.sleep(_DOWNLOAD_RETRY_DELAY_SECONDS)
                continue
            _log(f"Failed to download Code Interpreter hosted file {file_id}: {exc}")
            return None
        except (OSError, URLError) as exc:
            _log(f"Failed to download Code Interpreter hosted file {file_id}: {exc}")
            return None

    if data is None:
        _log(f"Code Interpreter hosted file {file_id} was not available after retries")
        return None

    if len(data) > _MAX_HOSTED_FILE_BYTES:
        _log(f"Code Interpreter hosted file {file_id} is too large to publish")
        return None

    media_type = _detect_image_media_type(data, content_type)
    if not media_type:
        _log(f"Code Interpreter hosted file {file_id} is not an image; content_type={content_type}")
        return None

    return data, media_type


def _upload_hosted_image(file_id: str, data: bytes, media_type: str) -> str | None:
    if not _STORAGE_ACCOUNT:
        _log(f"CHART_STORAGE_ACCOUNT is not configured; cannot publish Code Interpreter file {file_id}")
        return None

    try:
        account_url = f"https://{_STORAGE_ACCOUNT}.blob.core.windows.net"
        service = BlobServiceClient(account_url=account_url, credential=_get_credential())
        container = service.get_container_client(_STORAGE_CONTAINER)
        blob_name = f"chart-{uuid.uuid4().hex}.{_image_extension(media_type)}"

        container.upload_blob(
            name=blob_name,
            data=data,
            overwrite=False,
            content_settings=ContentSettings(content_type=media_type),
        )

        now = datetime.now(timezone.utc)
        delegation_key = service.get_user_delegation_key(
            key_start_time=now - timedelta(minutes=5),
            key_expiry_time=now + _SAS_TTL,
        )
        sas = generate_blob_sas(
            account_name=_STORAGE_ACCOUNT,
            container_name=_STORAGE_CONTAINER,
            blob_name=blob_name,
            user_delegation_key=delegation_key,
            permission=BlobSasPermissions(read=True),
            expiry=now + _SAS_TTL,
            start=now - timedelta(minutes=5),
            content_type=media_type,
        )
        return f"{account_url}/{_STORAGE_CONTAINER}/{blob_name}?{sas}"
    except (AzureError, OSError, ValueError) as exc:
        _log(f"Failed to publish Code Interpreter hosted file {file_id} to blob storage: {exc}")
        return None


def _hosted_file_chart_url(file_id: str) -> str | None:
    downloaded = _download_hosted_file(file_id)
    if not downloaded:
        return None
    data, media_type = downloaded
    return _upload_hosted_image(file_id, data, media_type)


def _hosted_file_text(file_id: str) -> str:
    chart_url = _hosted_file_chart_url(file_id)
    if chart_url:
        return f"\n\nChart URL: {chart_url}\n"

    return (
        "\n\nGenerated visual file id: "
        f"`{file_id}`. The generated file could not be attached before the response completed.\n\n"
    )


def _sanitize_model_text(text: str) -> str:
    without_markdown_links = _SANDBOX_MARKDOWN_LINK_PATTERN.sub("", text)
    return _SANDBOX_URI_PATTERN.sub("[generated visual attached]", without_markdown_links)


def apply_hosted_file_response_patch() -> None:
    """Preserve Foundry Code Interpreter generated files in hosted /responses output."""
    import agent_framework_foundry_hosting._responses as responses  # noqa: PLC0415

    if getattr(responses, _PATCH_MARKER, False):
        return

    original_to_outputs: Callable[..., AsyncIterator[object] | Awaitable[AsyncIterator[object]]] = responses._to_outputs

    async def to_outputs_with_hosted_files(stream, content: Content, *, approval_storage=None) -> AsyncIterator[object]:
        if content.type == "hosted_file":
            if not content.file_id:
                _log("Hosted file content is missing file_id; cannot surface artifact")
                return
            _log(f"Surfacing Code Interpreter hosted file: {content.file_id}")
            async for event in stream.aoutput_item_message(_hosted_file_text(content.file_id)):
                yield event
            return

        if content.type == "text" and content.text is not None:
            text_value = _sanitize_model_text(content.text)
            if not text_value:
                return
            if text_value != content.text:
                content = Content.from_text(text_value)

        async for event in original_to_outputs(stream, content, approval_storage=approval_storage):
            yield event

    responses._to_outputs = to_outputs_with_hosted_files
    setattr(responses, _PATCH_MARKER, True)
