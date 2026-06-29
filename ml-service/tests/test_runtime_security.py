from __future__ import annotations

import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from starlette.datastructures import Headers, UploadFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main


def build_upload_file(
    filename: str,
    content_type: str,
    data: bytes,
) -> UploadFile:
    return UploadFile(
        file=io.BytesIO(data),
        filename=filename,
        headers=Headers({"content-type": content_type}),
    )


class RuntimeSecurityTest(unittest.IsolatedAsyncioTestCase):
    def test_runtime_admin_requires_configured_secret(self) -> None:
        with patch.object(main, "ML_ADMIN_SECRET", ""):
            with self.assertRaises(HTTPException) as context:
                main.require_runtime_admin_secret(None)

        self.assertEqual(context.exception.status_code, 503)
        self.assertEqual(
            context.exception.detail,
            "ML runtime admin controls are disabled until ML_ADMIN_SECRET is configured.",
        )

    def test_runtime_admin_rejects_invalid_secret(self) -> None:
        with patch.object(main, "ML_ADMIN_SECRET", "expected-secret"):
            with self.assertRaises(HTTPException) as context:
                main.require_runtime_admin_secret("wrong-secret")

        self.assertEqual(context.exception.status_code, 403)
        self.assertEqual(
            context.exception.detail,
            "ML runtime admin secret was invalid.",
        )

    def test_runtime_admin_accepts_matching_secret(self) -> None:
        with patch.object(main, "ML_ADMIN_SECRET", "expected-secret"):
            main.require_runtime_admin_secret("expected-secret")

    async def test_ingest_pdf_returns_400_for_unparseable_uploads(self) -> None:
        upload = build_upload_file("broken.pdf", "application/pdf", b"not-a-real-pdf")

        try:
            with patch.object(main, "extract_text_from_pdf", side_effect=ValueError("bad pdf")):
                with self.assertRaises(HTTPException) as context:
                    await main.ingest_pdf(upload)
        finally:
            await upload.close()

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(
            context.exception.detail,
            "Uploaded PDF could not be parsed.",
        )

    async def test_ingest_docx_returns_400_for_unparseable_uploads(self) -> None:
        upload = build_upload_file(
            "broken.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            b"not-a-real-docx",
        )

        try:
            with patch.object(main, "extract_text_from_docx", side_effect=ValueError("bad docx")):
                with self.assertRaises(HTTPException) as context:
                    await main.ingest_docx(upload)
        finally:
            await upload.close()

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(
            context.exception.detail,
            "Uploaded DOCX could not be parsed.",
        )


if __name__ == "__main__":
    unittest.main()
