"""
Compatibility patch for Azure AI Agent Server's Agent Framework adapter.

azure-ai-agentserver-agentframework 1.0.0b17 invokes Foundry Code Interpreter
successfully, but its /responses output converters drop Agent Framework
`hosted_file` content. The hosted-agent UI also does not expose file_path
annotations or inline data URLs, so this patch downloads Code Interpreter image
files, uploads them to private blob storage, and returns a short-lived Chart URL.
"""

from __future__ import annotations

import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import AsyncIterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from agent_framework import AgentResponseUpdate, Content
from azure.core.exceptions import AzureError
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobSasPermissions, BlobServiceClient, ContentSettings, generate_blob_sas
from azure.ai.agentserver.agentframework.models.agent_framework_output_non_streaming_converter import (
    AgentFrameworkOutputNonStreamingConverter,
    logger as non_streaming_logger,
)
from azure.ai.agentserver.agentframework.models.agent_framework_output_streaming_converter import (
    AgentFrameworkOutputStreamingConverter,
)

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


def _hosted_file_url(file_id: str) -> str | None:
    project_endpoint = os.getenv("PROJECT_ENDPOINT") or os.getenv("AZURE_AI_PROJECT_ENDPOINT")
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
                non_streaming_logger.info(
                    "Code Interpreter hosted file %s is not available yet; retrying download (%d/%d)",
                    file_id,
                    attempt,
                    _DOWNLOAD_ATTEMPTS,
                )
                time.sleep(_DOWNLOAD_RETRY_DELAY_SECONDS)
                continue
            non_streaming_logger.warning("Failed to download Code Interpreter hosted file %s: %s", file_id, exc)
            return None
        except (OSError, URLError) as exc:
            non_streaming_logger.warning("Failed to download Code Interpreter hosted file %s: %s", file_id, exc)
            return None

    if data is None:
        non_streaming_logger.warning("Code Interpreter hosted file %s was not available after retries", file_id)
        return None

    if len(data) > _MAX_HOSTED_FILE_BYTES:
        non_streaming_logger.warning("Code Interpreter hosted file %s is too large to publish", file_id)
        return None

    media_type = _detect_image_media_type(data, content_type)
    if not media_type:
        non_streaming_logger.warning("Code Interpreter hosted file %s is not an image; content_type=%s", file_id, content_type)
        return None

    return data, media_type


def _upload_hosted_image(file_id: str, data: bytes, media_type: str) -> str | None:
    if not _STORAGE_ACCOUNT:
        non_streaming_logger.warning("CHART_STORAGE_ACCOUNT is not configured; cannot publish Code Interpreter file %s", file_id)
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
        non_streaming_logger.warning("Failed to publish Code Interpreter hosted file %s to blob storage: %s", file_id, exc)
        return None


def _hosted_file_chart_url(file_id: str) -> str | None:
    downloaded = _download_hosted_file(file_id)
    if not downloaded:
        return None
    data, media_type = downloaded
    return _upload_hosted_image(file_id, data, media_type)


def _hosted_file_text(file_id: str) -> Content:
    chart_url = _hosted_file_chart_url(file_id)
    if chart_url:
        return Content.from_text(
            f"\n\nChart URL: {chart_url}\n",
        )

    text = (
        "\n\nGenerated visual file id: "
        f"`{file_id}`. The generated file could not be attached before the response completed.\n\n"
    )
    return Content.from_text(text)


def _sanitize_model_text(text: str) -> str:
    without_markdown_links = _SANDBOX_MARKDOWN_LINK_PATTERN.sub("", text)
    return _SANDBOX_URI_PATTERN.sub("[generated visual attached]", without_markdown_links)


def _apply_non_streaming_patch() -> None:
    original_append_content = AgentFrameworkOutputNonStreamingConverter._append_content_item

    def append_text_content(self: AgentFrameworkOutputNonStreamingConverter, content: Content, sink: list[dict]) -> None:
        text_value = _sanitize_model_text(content.text or "")
        if not text_value:
            return
        item_id = self._context.id_generator.generate_message_id()  # pylint: disable=protected-access
        sink.append(
            {
                "id": item_id,
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [
                    {
                        "type": "output_text",
                        "text": text_value,
                        "annotations": [],
                        "logprobs": [],
                    }
                ],
            }
        )
        non_streaming_logger.debug("    added message item id=%s text_len=%d", item_id, len(text_value))

    def append_hosted_file_content(
        self: AgentFrameworkOutputNonStreamingConverter,
        content: Content,
        sink: list[dict],
    ) -> None:
        if not content.file_id:
            non_streaming_logger.warning("Hosted file content is missing file_id; cannot surface artifact")
            return
        if any(content.file_id in str(item) for item in sink):
            return
        non_streaming_logger.info("Surfacing Code Interpreter hosted file: %s", content.file_id)
        append_text_content(self, _hosted_file_text(content.file_id), sink)

    def append_content_item(self: AgentFrameworkOutputNonStreamingConverter, content: Content, sink: list[dict]) -> None:
        if content.type == "hosted_file":
            append_hosted_file_content(self, content, sink)
            return
        original_append_content(self, content, sink)

    AgentFrameworkOutputNonStreamingConverter._append_text_content = append_text_content
    AgentFrameworkOutputNonStreamingConverter._append_content_item = append_content_item


async def _read_updates_with_hosted_files(
    self: AgentFrameworkOutputStreamingConverter,
    updates: AsyncIterable[AgentResponseUpdate],
) -> AsyncIterable[tuple[Content, str]]:
    async for update in updates:
        if not update.contents:
            continue

        author_name = getattr(update, "author_name", "") or ""
        accepted_types = {"function_call", "user_input_request", "function_result", "error"}
        for content in update.contents:
            if content.type == "hosted_file":
                if content.file_id:
                    non_streaming_logger.info("Surfacing Code Interpreter hosted file: %s", content.file_id)
                    yield (_hosted_file_text(content.file_id), author_name)
                continue
            if content.type == "text":
                text_value = _sanitize_model_text(content.text or "")
                if text_value:
                    yield (Content.from_text(text_value), author_name)
                continue
            if content.type in accepted_types:
                yield (content, author_name)


def _apply_streaming_patch() -> None:
    AgentFrameworkOutputStreamingConverter._read_updates = _read_updates_with_hosted_files


def apply_hosted_file_response_patch() -> None:
    """Preserve Foundry Code Interpreter generated files in hosted /responses output."""
    if getattr(AgentFrameworkOutputStreamingConverter, _PATCH_MARKER, False):
        return

    _apply_non_streaming_patch()
    _apply_streaming_patch()
    setattr(AgentFrameworkOutputStreamingConverter, _PATCH_MARKER, True)
