from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse


_CHART_URL_PATTERN = re.compile(
    r"""
    (?:
        ^\s*(?:[-*]\s*)?\[?\s*
        (?:chart|graph|visual(?:ization)?)
        (?:\s+(?:url|link|available|image|artifact))?
        \s*\]?\s*(?::|=|-)\s*
    )
    (?P<url><https?://[^>\s]+>|https?://[^\s<>\])]+)
    """,
    re.IGNORECASE | re.MULTILINE | re.VERBOSE,
)
_MARKDOWN_CHART_LINK_PATTERN = re.compile(
    r"""
    \[
        (?:chart|graph|visual(?:ization)?)
        (?:\s+(?:url|link|available|image|artifact))?
        [^\]]*
    \]
    \(
        (?P<url>https?://[^\s<>)]+)
    \)
    """,
    re.IGNORECASE | re.VERBOSE,
)


@dataclass(frozen=True)
class ChartExtraction:
    text: str
    chart_url: str | None

    @property
    def has_chart(self) -> bool:
        return self.chart_url is not None


def normalize_http_url(candidate: str | None) -> str | None:
    if not candidate:
        return None

    value = candidate.strip().strip("<>\"'")
    value = value.rstrip(".,;")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    if any(ord(character) < 32 for character in value):
        return None

    return value


def extract_chart_response(text: str | None) -> ChartExtraction:
    response_text = text or ""
    chart_url = _find_chart_url(response_text)
    return ChartExtraction(
        text=_remove_chart_url_references(response_text, chart_url),
        chart_url=chart_url,
    )


def _find_chart_url(text: str) -> str | None:
    for pattern in (_CHART_URL_PATTERN, _MARKDOWN_CHART_LINK_PATTERN):
        for match in pattern.finditer(text):
            url = normalize_http_url(match.group("url"))
            if url:
                return url

    return None


def _remove_chart_url_references(text: str, chart_url: str | None) -> str:
    if not text:
        return ""
    if not chart_url:
        return text.strip()

    cleaned_lines: list[str] = []
    for line in text.splitlines():
        if _line_is_chart_reference(line, chart_url):
            continue
        cleaned_lines.append(line.rstrip())

    cleaned = "\n".join(cleaned_lines).strip()
    return re.sub(r"\n{3,}", "\n\n", cleaned)


def _line_is_chart_reference(line: str, chart_url: str | None) -> bool:
    if chart_url and chart_url in line:
        return bool(
            _CHART_URL_PATTERN.search(line)
            or _MARKDOWN_CHART_LINK_PATTERN.search(line)
        )

    return bool(
        _CHART_URL_PATTERN.search(line) or _MARKDOWN_CHART_LINK_PATTERN.search(line)
    )
