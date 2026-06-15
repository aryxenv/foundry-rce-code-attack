from __future__ import annotations

import asyncio
import json
import os
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlparse


AgentKind = Literal["unsecure", "secure"]

DEFAULT_AGENT_ENDPOINT = "http://localhost:8088"
DEFAULT_RESPONSES_PATH = "/responses"
DEFAULT_TIMEOUT_SECONDS = 45.0
MAX_RAW_RESPONSE_CHARS = 12_000

DEFAULT_AGENT_NAMES: dict[AgentKind, str] = {
    "unsecure": "ContosoMarketResearch",
    "secure": "ContosoMarketResearchSecure",
}


@dataclass(frozen=True)
class DemoAgentConfig:
    kind: AgentKind
    name: str
    endpoint: str
    responses_path: str
    timeout_seconds: float

    @property
    def responses_url(self) -> str:
        return build_responses_url(self.endpoint, self.responses_path)


@dataclass(frozen=True)
class DemoAgentResult:
    text: str
    raw_response: Any | None


class DemoAgentError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        detail: str | None = None,
        raw_response: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail
        self.raw_response = raw_response


def get_agent_config(kind: AgentKind) -> DemoAgentConfig:
    suffix = kind.upper()
    timeout_seconds = _read_timeout_seconds()
    return DemoAgentConfig(
        kind=kind,
        name=os.getenv(f"DEMO_AGENT_NAME_{suffix}") or DEFAULT_AGENT_NAMES[kind],
        endpoint=(
            os.getenv(f"DEMO_AGENT_ENDPOINT_{suffix}")
            or os.getenv("DEMO_AGENT_ENDPOINT")
            or DEFAULT_AGENT_ENDPOINT
        ),
        responses_path=(
            os.getenv(f"DEMO_AGENT_PATH_{suffix}")
            or os.getenv("DEMO_AGENT_RESPONSES_PATH")
            or DEFAULT_RESPONSES_PATH
        ),
        timeout_seconds=timeout_seconds,
    )


async def run_agent_response(
    config: DemoAgentConfig,
    *,
    prompt: str,
    scenario: str,
) -> DemoAgentResult:
    request_body = {
        "model": config.name,
        "input": prompt,
        "stream": False,
        "store": False,
        "metadata": {
            "scenario": scenario,
            "source": "webslides-demo",
        },
    }

    return await asyncio.to_thread(
        _post_responses_request,
        config.responses_url,
        request_body,
        config.timeout_seconds,
    )


def build_responses_url(endpoint: str, responses_path: str) -> str:
    base = endpoint.strip().rstrip("/")
    parsed = urlparse(base)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise DemoAgentError(
            "invalid_agent_endpoint",
            "Demo agent endpoint must be an absolute http(s) URL.",
            detail=f"Configured endpoint: {endpoint}",
        )

    path = responses_path.strip()
    if not path:
        return base

    normalized_path = f"/{path.strip('/')}"
    if parsed.path.rstrip("/").endswith(normalized_path.rstrip("/")):
        return base

    return f"{base}{normalized_path}"


def extract_response_text(payload: Any) -> str:
    if isinstance(payload, str):
        return payload

    if not isinstance(payload, dict):
        raise DemoAgentError(
            "invalid_agent_response",
            "Demo agent returned an unsupported response payload.",
            detail=f"Payload type: {type(payload).__name__}",
            raw_response=payload,
        )

    for key in ("output_text", "text"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value

    output_text = _collect_output_text(payload.get("output"))
    if output_text:
        return output_text

    choices_text = _collect_choices_text(payload.get("choices"))
    if choices_text:
        return choices_text

    raise DemoAgentError(
        "missing_agent_text",
        "Demo agent response did not include assistant text.",
        raw_response=payload,
    )


def _post_responses_request(
    url: str,
    request_body: dict[str, Any],
    timeout_seconds: float,
) -> DemoAgentResult:
    body_bytes = json.dumps(request_body).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body_bytes,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "webslides-demo-backend/1.0",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            body_text = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        error_body = error.read().decode("utf-8", errors="replace")
        raw_response = _safe_raw_response(error_body)
        raise DemoAgentError(
            "agent_http_error",
            f"Demo agent responded with HTTP {error.code}.",
            detail=_trim_detail(error_body),
            raw_response=raw_response,
        ) from error
    except (urllib.error.URLError, TimeoutError, socket.timeout) as error:
        raise DemoAgentError(
            "agent_unavailable",
            "Demo agent endpoint is unavailable or timed out.",
            detail=str(error),
        ) from error

    payload = _decode_response_payload(body_text)
    safe_raw_response = _safe_raw_response(body_text)
    try:
        text = extract_response_text(payload)
    except DemoAgentError as error:
        raise DemoAgentError(
            error.code,
            error.message,
            detail=error.detail,
            raw_response=safe_raw_response,
        ) from error

    return DemoAgentResult(text=text, raw_response=safe_raw_response)


def _decode_response_payload(body_text: str) -> Any:
    try:
        return json.loads(body_text)
    except json.JSONDecodeError:
        if body_text.strip():
            return body_text
        raise DemoAgentError(
            "empty_agent_response",
            "Demo agent returned an empty response.",
        ) from None


def _safe_raw_response(body_text: str) -> Any | None:
    if len(body_text) > MAX_RAW_RESPONSE_CHARS:
        return None

    try:
        return json.loads(body_text)
    except json.JSONDecodeError:
        return body_text


def _collect_output_text(output: Any) -> str:
    if not isinstance(output, list):
        return ""

    parts: list[str] = []
    for item in output:
        if not isinstance(item, dict):
            continue

        content = item.get("content")
        if isinstance(content, list):
            for content_item in content:
                text = _content_item_text(content_item)
                if text:
                    parts.append(text)
            continue

        text = _content_item_text(item)
        if text:
            parts.append(text)

    return "\n".join(parts).strip()


def _collect_choices_text(choices: Any) -> str:
    if not isinstance(choices, list):
        return ""

    parts: list[str] = []
    for choice in choices:
        if not isinstance(choice, dict):
            continue
        for key in ("message", "delta"):
            message = choice.get(key)
            if isinstance(message, dict):
                content = message.get("content")
                if isinstance(content, str):
                    parts.append(content)

    return "\n".join(parts).strip()


def _content_item_text(item: Any) -> str:
    if not isinstance(item, dict):
        return ""

    for key in ("text", "output_text", "refusal"):
        value = item.get(key)
        if isinstance(value, str):
            return value

    return ""


def _read_timeout_seconds() -> float:
    configured = os.getenv("DEMO_AGENT_TIMEOUT_SECONDS")
    if not configured:
        return DEFAULT_TIMEOUT_SECONDS

    try:
        timeout_seconds = float(configured)
    except ValueError as error:
        raise DemoAgentError(
            "invalid_agent_timeout",
            "DEMO_AGENT_TIMEOUT_SECONDS must be a number.",
            detail=f"Configured value: {configured}",
        ) from error

    if timeout_seconds <= 0:
        raise DemoAgentError(
            "invalid_agent_timeout",
            "DEMO_AGENT_TIMEOUT_SECONDS must be greater than zero.",
            detail=f"Configured value: {configured}",
        )

    return timeout_seconds


def _trim_detail(value: str, limit: int = 1_000) -> str | None:
    text = value.strip()
    if not text:
        return None
    if len(text) <= limit:
        return text
    return f"{text[:limit]}..."
