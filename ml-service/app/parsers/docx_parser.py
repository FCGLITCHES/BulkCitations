from __future__ import annotations

import io
import re
from typing import Any

from docx import Document


_BIB_HEADING_RE = re.compile(
    r"(?i)^(references|bibliography|works\s+cited|literature\s+cited)\s*$"
)


def extract_text_from_docx(file_bytes: bytes) -> dict[str, Any]:
    doc = Document(io.BytesIO(file_bytes))

    paragraphs: list[str] = []
    section_headers: list[str] = []
    has_bibliography = False

    for para in doc.paragraphs:
        text = para.text.strip()

        is_heading = (
            para.style is not None
            and para.style.name is not None
            and "Heading" in para.style.name
        )

        if is_heading:
            section_headers.append(text)

        if is_heading and _BIB_HEADING_RE.match(text):
            has_bibliography = True
        elif _BIB_HEADING_RE.match(text):
            has_bibliography = True

        paragraphs.append(text)

    raw_text = "\n".join(paragraphs)

    return {
        "rawText": raw_text,
        "metadata": {
            "hasBibliography": has_bibliography,
            "sectionHeaders": section_headers,
        },
    }
