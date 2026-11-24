import base64
import json
from types import SimpleNamespace
import pytest
from fastapi import Response
from app.attachments import prefix
from app.routes.attachments import export_upload_text
import io
from botocore.exceptions import ClientError
from app import attachments


@pytest.fixture
def storage(monkeypatch):
    monkeypatch.setenv("LARGE_MESSAGE_BUCKET", "synthetic-private-bucket")
    objects = {}

    def get_object(Bucket, Key):
        if Key not in objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return {"Body": io.BytesIO(objects[Key]), "ContentLength": len(objects[Key])}

    client = SimpleNamespace(objects=objects, get_object=get_object)
    monkeypatch.setattr(attachments, "s3", lambda: client)
    monkeypatch.setattr("app.routes.attachments.s3", lambda: client)
    monkeypatch.setattr(attachments, "bucket_name", lambda: "synthetic-private-bucket")
    return client


def test_complete_attachment_text_is_not_truncated_to_the_preview_limit(storage):
    root = prefix("user-a", "a" * 32)
    text = "😀" * 30000 + "END-OF-FULL-FILE"
    storage.objects[root + "manifest.json"] = json.dumps(
        {
            "kind": "text",
            "filename": "note.txt",
            "characters": len(text),
            "notice": "Extracted text",
        }
    ).encode()
    storage.objects[root + "content"] = text.encode()
    result = export_upload_text(
        SimpleNamespace(
            state=SimpleNamespace(current_user=SimpleNamespace(id="user-a"))
        ),
        "a" * 32,
        Response(),
    )
    assert base64.b64decode(result["textBase64"]).decode() == text
    assert "objectKey" not in result and "downloadUrl" not in result


def test_original_document_is_explicitly_not_included(storage):
    root = prefix("user-a", "a" * 32)
    storage.objects[root + "manifest.json"] = json.dumps(
        {"kind": "document", "filename": "original.pdf", "characters": 0}
    ).encode()
    result = export_upload_text(
        SimpleNamespace(
            state=SimpleNamespace(current_user=SimpleNamespace(id="user-a"))
        ),
        "a" * 32,
        Response(),
    )
    assert result["textBase64"] is None
    assert result["kind"] == "document"


def test_a_different_user_cannot_export_the_owners_file(storage):
    root = prefix("user-a", "a" * 32)
    storage.objects[root + "manifest.json"] = json.dumps(
        {"kind": "text", "filename": "private.txt", "characters": 1}
    ).encode()
    storage.objects[root + "content"] = b"private content"
    with pytest.raises(ValueError):
        export_upload_text(
            SimpleNamespace(
                state=SimpleNamespace(current_user=SimpleNamespace(id="user-b"))
            ),
            "a" * 32,
            Response(),
        )


def test_existing_preview_remains_readable_utf8_and_limited(storage):
    from app.routes.attachments import preview_upload

    root = prefix("user-a", "a" * 32)
    text = "😀" * 30000 + "END"
    storage.objects[root + "manifest.json"] = json.dumps(
        {"kind": "text", "filename": "note.txt", "characters": len(text)}
    ).encode()
    storage.objects[root + "content"] = text.encode()
    storage.generate_presigned_url = (
        lambda *args, **kwargs: "https://example.invalid/original"
    )
    request = SimpleNamespace(
        state=SimpleNamespace(current_user=SimpleNamespace(id="user-a"))
    )
    result = preview_upload(request, "a" * 32)
    assert result["preview"] == text[:20000]
    assert result["previewTruncated"] is True
