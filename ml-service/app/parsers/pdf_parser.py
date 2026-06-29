from __future__ import annotations

import io
import re
from typing import Any

import pdfplumber


def extract_text_from_pdf(file_bytes: bytes) -> dict[str, Any]:
    pages_text: list[str] = []
    page_count = 0
    has_columns = False
    has_footnotes = False

    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        page_count = len(pdf.pages)
        for page in pdf.pages:
            words = page.extract_words()
            if words:
                x_starts = sorted({round(w["x0"], -1) for w in words})
                if _detect_columns(x_starts, page.width):
                    has_columns = True
                    text = _extract_multicolumn(page)
                else:
                    text = page.extract_text() or ""
            else:
                text = page.extract_text() or ""

            text = _strip_header_footer(text)

            if re.search(
                r"(?i)\bfootnote|^\d+\s+\w{3,}", text, re.MULTILINE
            ):
                has_footnotes = True

            pages_text.append(text)

    raw_text = "\n\n".join(pages_text).strip()
    return {
        "rawText": raw_text,
        "pageCount": page_count,
        "metadata": {
            "hasColumns": has_columns,
            "hasFootnotes": has_footnotes,
        },
    }


def _detect_columns(x_positions: list[float], page_width: float) -> bool:
    """Return True when there are >=2 distinct left-margin clusters."""
    if len(x_positions) < 2:
        return False
    gap_threshold = page_width * 0.20
    clusters = 1
    prev = x_positions[0]
    for x in x_positions[1:]:
        if x - prev > gap_threshold:
            clusters += 1
        prev = x
    return clusters >= 2


def _extract_multicolumn(page: Any) -> str:
    mid = page.width / 2
    left_box = (0, 0, mid, page.height)
    right_box = (mid, 0, page.width, page.height)
    left_text = page.crop(left_box).extract_text() or ""
    right_text = page.crop(right_box).extract_text() or ""
    return f"{left_text}\n{right_text}"


_PAGE_NUM_RE = re.compile(r"^\s*(?:page\s*)?\d{1,5}\s*(?:of\s*\d+)?\s*$", re.IGNORECASE)
_RUNNING_HEAD_RE = re.compile(r"^\s*(?:running head|header|footer)\b", re.IGNORECASE)
_COPYRIGHT_RE = re.compile(r"^\s*(?:©|copyright)\b", re.IGNORECASE)


def _strip_header_footer(text: str) -> str:
    lines = text.split("\n")
    cleaned: list[str] = []
    for idx, line in enumerate(lines):
        stripped = line.strip()
        is_boundary = idx in (0, len(lines) - 1)
        if is_boundary and re.match(r"^\d{1,4}$", stripped):
            continue
        if _PAGE_NUM_RE.match(stripped):
            continue
        if _RUNNING_HEAD_RE.match(stripped):
            continue
        if _COPYRIGHT_RE.match(stripped):
            continue
        cleaned.append(line)
    return "\n".join(cleaned)
