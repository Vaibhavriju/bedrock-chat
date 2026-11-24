import io
import hashlib
import json
import zipfile

import pytest
from botocore.exceptions import ClientError
from openpyxl import Workbook

from app import attachments as uploads
from app.repositories.models.conversation import AttachmentContentModel
from app.routes.schemas.conversation import AttachmentContent
from app.strands_integration.converters.content_converter import (
    content_model_to_strands_content_blocks,
)


class MemoryS3:
    def __init__(self):
        self.objects = {}
        self.posts = []

    def put_object(self, Bucket, Key, Body, **kwargs):
        if (
            "IfMatch" in kwargs
            and kwargs["IfMatch"] != hashlib.md5(self.objects[Key]).hexdigest()
        ):
            raise ClientError({"Error": {"Code": "PreconditionFailed"}}, "PutObject")
        self.objects[Key] = Body if isinstance(Body, bytes) else Body.encode()

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        data = self.objects[Key]
        return {
            "Body": io.BytesIO(data),
            "ContentLength": len(data),
            "ETag": hashlib.md5(data).hexdigest(),
        }

    def put_object_tagging(self, **kwargs):
        pass

    def delete_objects(self, Bucket, Delete):
        for item in Delete["Objects"]:
            self.objects.pop(item["Key"], None)
        return {}

    def generate_presigned_post(self, **kwargs):
        self.posts.append(kwargs)
        return {
            "url": "https://example.s3.amazonaws.com",
            "fields": {"key": kwargs["Key"]},
        }


@pytest.fixture
def storage(monkeypatch):
    client = MemoryS3()
    monkeypatch.setenv("LARGE_MESSAGE_BUCKET", "test-private-bucket")
    monkeypatch.setattr(uploads, "s3", lambda: client)
    return client


def archive(files):
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(name, content)
    return result.getvalue()


def finish(storage, name, data, user="alice"):
    result = uploads.create_upload(user, name, len(data))
    storage.objects[result["fields"]["key"]] = data
    return uploads.complete_upload(user, result["uploadId"])


def test_upload_reference_stays_small_and_both_inference_paths_resolve_full_text(
    storage,
):
    text = "const count = 1;\n" * 2000
    ready = finish(storage, "module.TS", text.encode())
    content = AttachmentContent(
        content_type="attachment",
        file_name=ready["fileName"],
        object_key=ready["objectKey"],
    )
    model = AttachmentContentModel.from_attachment_content(content)
    # File bytes never go back into the conversation response/history.
    assert len(model.to_content().model_dump_json()) < 500
    assert not model.body
    assert model.to_contents_for_converse()[0]["text"].endswith(text)
    assert content_model_to_strands_content_blocks(model)[0]["text"].endswith(text)
    assert storage.posts[0]["Conditions"][0] == [
        "content-length-range",
        len(text),
        len(text),
    ]


def test_cross_user_and_arbitrary_keys_are_rejected_before_s3_access(storage):
    ready = finish(storage, "Dockerfile", b"FROM node:22\n")
    with pytest.raises(PermissionError):
        uploads.read_manifest(ready["objectKey"], "bob")
    with pytest.raises(ValueError, match="Invalid attachment"):
        uploads.read_manifest("alice/private-secret.json", "alice")
    with pytest.raises(ValueError, match="Invalid upload"):
        uploads.complete_upload("alice", "../bob/upload")


def test_incomplete_upload_and_size_limits(storage):
    result = uploads.create_upload("alice", "test.py", 20)
    storage.objects[result["fields"]["key"]] = b"short"
    with pytest.raises(ValueError, match="incomplete"):
        uploads.complete_upload("alice", result["uploadId"])
    with pytest.raises(ValueError, match="25 MB"):
        uploads.create_upload("alice", "test.py", uploads.MAX_UPLOAD_BYTES + 1)


def test_source_zip_preserves_paths_and_reports_omissions(storage):
    data = archive(
        {
            "src/app.ts": "export const n = 1",
            "src/util.py": "print('hi')",
            "node_modules/pkg/index.js": "generated",
            ".env": "SECRET=private",
            "photo.png": b"\x00binary",
        }
    )
    result = finish(storage, "source.ZIP", data)
    meta, payload = uploads.attachment_content(result["objectKey"])
    assert "src/app.ts" in payload.decode()
    assert "src/util.py" in payload.decode()
    assert b"SECRET" not in payload
    assert "Read 2 source files; skipped 3" in meta["notice"]


def test_archive_and_text_limits_do_not_silently_truncate(storage, monkeypatch):
    monkeypatch.setattr(uploads, "MAX_TEXT_CHARACTERS", 20)
    with pytest.raises(ValueError, match="Nothing was truncated"):
        uploads.extract_file("test.ts", b"x" * 21)
    monkeypatch.setattr(uploads, "MAX_ARCHIVE_ENTRIES", 1)
    with pytest.raises(ValueError, match="1,000 entries"):
        uploads.extract_file("source.zip", archive({"a.py": "a", "b.py": "b"}))


def test_office_extraction_is_explicit_about_missing_visuals(storage):
    docx = archive(
        {
            "word/document.xml": '<w:document xmlns:w="urn:word"><w:t>Hello</w:t></w:document>'
        }
    )
    result = finish(storage, "report.DOCX", docx)
    assert "images" in result["notice"]
    assert uploads.attachment_content(result["objectKey"])[1] == b"Hello"
    pptx = archive(
        {
            "ppt/slides/slide2.xml": '<a:p xmlns:a="urn:p"><a:t>Second</a:t></a:p>',
            "ppt/slides/slide1.xml": '<a:p xmlns:a="urn:p"><a:t>First</a:t></a:p>',
        }
    )
    _, text, notice = uploads.extract_file("slides.pptx", pptx)
    assert text == b"First\n\nSecond"
    assert "layout" in notice


def test_spreadsheet_values_and_sheet_names_are_preserved(storage):
    book = Workbook()
    book.active.title = "Swaps"
    book.active.append(["Station", "Count"])
    book.active.append(["Warje", 42])
    output = io.BytesIO()
    book.save(output)
    result = finish(storage, "stations.xlsx", output.getvalue())
    text = uploads.attachment_content(result["objectKey"])[1].decode()
    assert "Sheet: Swaps" in text and "Warje\t42" in text
    assert "formulas" in result["notice"]


def test_native_document_and_legacy_source_file_conversion(storage):
    result = finish(storage, "report.PDF", b"%PDF-test")
    model = AttachmentContentModel(
        content_type="attachment",
        file_name="report.PDF",
        object_key=result["objectKey"],
    )
    block = model.to_contents_for_converse()[0]
    assert block["document"]["format"] == "pdf"
    assert block["document"]["source"]["bytes"] == b"%PDF-test"
    legacy = AttachmentContentModel(
        content_type="attachment", file_name="code.py", body=b"print(42)"
    )
    assert legacy.to_contents_for_converse()[0]["text"].endswith("print(42)")


def test_completion_is_idempotent_and_bound_files_cannot_cross_conversations(storage):
    result = finish(storage, "module.ts", b"export const answer = 42")
    upload_id = result["objectKey"].split("/")[2]
    repeated = uploads.complete_upload("alice", upload_id)
    assert repeated["objectKey"] == result["objectKey"]
    uploads.bind_attachment(result["objectKey"], "alice", "chat-one")
    uploads.bind_attachment(result["objectKey"], "alice", "chat-one")
    with pytest.raises(ValueError, match="another conversation"):
        uploads.bind_attachment(result["objectKey"], "alice", "chat-two")
    uploads.delete_chat_attachments("alice", "chat-two", {result["objectKey"]})
    assert result["objectKey"] in storage.objects
    uploads.delete_chat_attachments("alice", "chat-one", {result["objectKey"]})
    assert result["objectKey"] not in storage.objects
    uploads.delete_chat_attachments("alice", "chat-one", {result["objectKey"]})


def test_prepare_conversation_rejects_other_users_and_combined_context(storage):
    from unittest.mock import patch
    from app.repositories.common import RecordNotFoundError
    from app.routes.schemas.conversation import ChatInput
    from app.usecases.chat import prepare_conversation
    from app.user import User

    user = User(id="alice", name="Alice", email="alice@example.com", groups=[])
    other = finish(storage, "code.ts", b"const a = 1;", user="bob")
    own = finish(storage, "own.ts", b"const b = 2;")

    def chat_input(keys):
        return ChatInput.model_validate(
            {
                "conversationId": "chat-one",
                "message": {
                    "role": "user",
                    "model": "claude-v4.6-sonnet",
                    "content": [
                        *[
                            {
                                "contentType": "attachment",
                                "fileName": "code.ts",
                                "objectKey": key,
                            }
                            for key in keys
                        ],
                        {"contentType": "text", "body": "Review these files"},
                    ],
                    "parentMessageId": "system",
                },
            }
        )

    with patch(
        "app.usecases.chat.find_conversation_by_id",
        side_effect=RecordNotFoundError("new"),
    ):
        with pytest.raises(PermissionError):
            prepare_conversation(user, chat_input([other["objectKey"]]))
        with patch.object(uploads, "MAX_TEXT_CHARACTERS", 15):
            with pytest.raises(ValueError, match="conversation exceed"):
                prepare_conversation(
                    user, chat_input([own["objectKey"], own["objectKey"]])
                )
        _, conversation, _ = prepare_conversation(user, chat_input([own["objectKey"]]))
        assert len(conversation.model_dump_json()) < 2000


def test_pdf_above_native_limit_extracts_searchable_text_without_truncation(storage):
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    writer = PdfWriter()
    page = writer.add_blank_page(width=600, height=800)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {
            NameObject("/Font"): DictionaryObject(
                {NameObject("/F1"): writer._add_object(font)}
            )
        }
    )
    stream = DecodedStreamObject()
    stream.set_data(
        b" " * (uploads.NATIVE_DOCUMENT_BYTES + 100)
        + b"BT /F1 12 Tf (BatteryPool searchable content) Tj ET"
    )
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    result = finish(storage, "large.pdf", output.getvalue())
    manifest, payload = uploads.attachment_content(result["objectKey"])
    assert manifest["kind"] == "text"
    assert b"BatteryPool searchable content" in payload
    assert "scanned pages" in manifest["notice"]
