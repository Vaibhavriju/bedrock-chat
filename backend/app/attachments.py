"""Bounded, private chat uploads. Conversation records contain references, not files."""

import io
import json
import os
import re
import uuid
import zipfile
from functools import lru_cache
from pathlib import PurePosixPath
from xml.etree import ElementTree

import boto3
from botocore.exceptions import ClientError

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_TEXT_CHARACTERS = 600_000
MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 1000
NATIVE_DOCUMENT_BYTES = int(4.5 * 1024 * 1024)
TEXT_EXTENSIONS = {
    ".txt",
    ".md",
    ".mdx",
    ".csv",
    ".tsv",
    ".log",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
    ".toml",
    ".xml",
    ".html",
    ".css",
    ".scss",
    ".sql",
    ".py",
    ".ipynb",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".java",
    ".cs",
    ".php",
    ".c",
    ".cpp",
    ".cxx",
    ".h",
    ".hpp",
    ".rs",
    ".r",
    ".rmd",
    ".swift",
    ".go",
    ".rb",
    ".kt",
    ".kts",
    ".m",
    ".scala",
    ".dart",
    ".lua",
    ".pl",
    ".pm",
    ".t",
    ".sh",
    ".bash",
    ".zsh",
    ".ini",
    ".config",
    ".proto",
    ".bat",
    ".coffee",
    ".tex",
    ".latex",
    ".vue",
    ".svelte",
    ".graphql",
    ".gql",
    ".tf",
    ".tfvars",
    ".properties",
}
SPECIAL_NAMES = {
    "dockerfile",
    "makefile",
    "gemfile",
    "procfile",
    ".gitignore",
    ".dockerignore",
}
SUPPORTED_EXTENSIONS = TEXT_EXTENSIONS | {
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".pptx",
    ".zip",
}
SKIP_DIRECTORIES = {
    ".git",
    "node_modules",
    "vendor",
    "dist",
    "build",
    ".venv",
    "venv",
    "__pycache__",
    ".next",
    ".aws",
    ".ssh",
}


class AttachmentMissingError(ValueError):
    pass


def bucket_name() -> str:
    bucket = os.environ.get("LARGE_MESSAGE_BUCKET")
    if not bucket:
        raise ValueError(
            "Chat uploads are not configured. Deploy the backend and frontend together."
        )
    return bucket


@lru_cache(maxsize=1)
def s3():
    # Use the bucket's deployment Region, which may differ from the Bedrock Region.
    return boto3.client("s3")


def prefix(user_id: str, upload_id: str) -> str:
    if not re.fullmatch(r"[a-f0-9]{32}", upload_id):
        raise ValueError("Invalid upload ID.")
    return f"chat-attachments/{user_id}/{upload_id}/"


def supported_file(name: str) -> bool:
    path = PurePosixPath(name.lower())
    return path.suffix in SUPPORTED_EXTENSIONS or path.name in SPECIAL_NAMES


def read_object(key: str, limit: int) -> bytes:
    try:
        result = s3().get_object(Bucket=bucket_name(), Key=key)
    except ClientError as exc:
        if exc.response["Error"]["Code"] in {"NoSuchKey", "404"}:
            raise AttachmentMissingError(
                "Attachment is missing. Remove it and upload it again."
            ) from exc
        raise
    stream = result["Body"]
    try:
        if result["ContentLength"] > limit:
            raise ValueError("Attachment exceeds its processing limit.")
        body = stream.read(limit + 1)
        if len(body) > limit:
            raise ValueError("Attachment exceeds its processing limit.")
        return body
    finally:
        stream.close()


def put_json(key: str, data: dict, unattached: bool = False):
    extra = {"Tagging": "chat-upload-status=unattached"} if unattached else {}
    s3().put_object(
        Bucket=bucket_name(),
        Key=key,
        Body=json.dumps(data).encode(),
        ContentType="application/json",
        **extra,
    )


def create_upload(user_id: str, filename: str, size: int) -> dict:
    if not filename or len(filename) > 240 or "/" in filename or "\\" in filename:
        raise ValueError("Use a file name without directories (up to 240 characters).")
    if not supported_file(filename):
        raise ValueError(
            "Unsupported file. Upload code, text, PDF, Office documents, or a source ZIP."
        )
    if not 0 < size <= MAX_UPLOAD_BYTES:
        raise ValueError("Choose a non-empty file up to 25 MB.")
    upload_id = uuid.uuid4().hex
    root = prefix(user_id, upload_id).replace(
        "chat-attachments/", "chat-upload-staging/", 1
    )
    put_json(root + "upload.json", {"filename": filename, "size": size})
    # POST enforces size at S3, before Lambda ever reads the bytes.
    signed = s3().generate_presigned_post(
        Bucket=bucket_name(),
        Key=root + "raw",
        ExpiresIn=900,
        Fields={"Content-Type": "application/octet-stream"},
        Conditions=[
            ["content-length-range", size, size],
            {"Content-Type": "application/octet-stream"},
        ],
    )
    return {"uploadId": upload_id, "url": signed["url"], "fields": signed["fields"]}


def checked_text(text: str) -> str:
    if not text.strip():
        raise ValueError(
            "No readable text found. For scanned PDFs, upload a searchable/OCR version."
        )
    if len(text) > MAX_TEXT_CHARACTERS:
        raise ValueError(
            "This file exceeds 600,000 extracted characters. Split it or add it to a knowledge-base bot. Nothing was truncated."
        )
    return text


def decode_text(data: bytes) -> str:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("Save text/code files as UTF-8 before uploading.") from exc
    if "\x00" in text:
        raise ValueError("This file contains binary data rather than readable text.")
    return checked_text(text)


def checked_archive(data: bytes) -> zipfile.ZipFile:
    archive = zipfile.ZipFile(io.BytesIO(data))
    entries = archive.infolist()
    if (
        len(entries) > MAX_ARCHIVE_ENTRIES
        or sum(e.file_size for e in entries) > MAX_ARCHIVE_BYTES
    ):
        archive.close()
        raise ValueError(
            "Archive expands beyond 50 MB or 1,000 entries. Upload a smaller source-only archive."
        )
    if any(e.flag_bits & 1 for e in entries):
        archive.close()
        raise ValueError("Password-protected archives are not supported.")
    return archive


def extract_file(filename: str, data: bytes) -> tuple[str, bytes, str]:
    """Return kind, complete payload and a visible extraction notice; never truncate."""
    suffix = PurePosixPath(filename.lower()).suffix
    if suffix in {".pdf", ".doc", ".xls"} and len(data) <= NATIVE_DOCUMENT_BYTES:
        return "document", data, "Original document; use a Claude model."
    if suffix in {".doc", ".xls"}:
        raise ValueError("For DOC/XLS files over 4.5 MB, save as DOCX/XLSX first.")
    if suffix == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise ValueError("Remove the PDF password before uploading.")
        if len(reader.pages) > 1000:
            raise ValueError(
                "PDF exceeds 1,000 pages. Split it or use a knowledge-base bot."
            )
        parts: list[str] = []
        length = 0
        for page in reader.pages:
            part = page.extract_text() or ""
            length += len(part) + 2
            if length > MAX_TEXT_CHARACTERS:
                raise ValueError(
                    "PDF exceeds 600,000 extracted characters. Split it; nothing was truncated."
                )
            parts.append(part)
        return (
            "text",
            checked_text("\n\n".join(parts)).encode(),
            "Text extracted from large PDF; scanned pages, diagrams and images are not included.",
        )
    if suffix == ".xlsx":
        from openpyxl import load_workbook

        with checked_archive(data):
            pass
        book = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        parts = []
        length = 0
        try:
            for sheet in book:
                parts.append(f"\nSheet: {sheet.title}\n")
                for row in sheet.iter_rows(values_only=True):
                    line = "\t".join("" if v is None else str(v) for v in row)
                    length += len(line) + 1
                    if length > MAX_TEXT_CHARACTERS:
                        raise ValueError(
                            "Spreadsheet exceeds 600,000 extracted characters. Export the relevant sheets or rows; nothing was truncated."
                        )
                    parts.append(line)
        finally:
            book.close()
        return (
            "text",
            checked_text("\n".join(parts)).encode(),
            "Sheet values extracted. Uncached formulas may be blank; charts, formatting and macros are not included.",
        )
    if suffix in {".docx", ".pptx", ".zip"}:
        with checked_archive(data) as archive:
            if suffix in {".docx", ".pptx"}:
                names = (
                    ["word/document.xml"]
                    if suffix == ".docx"
                    else sorted(
                        (
                            n
                            for n in archive.namelist()
                            if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)
                        ),
                        key=lambda n: int(re.search(r"slide(\d+)", n).group(1)),
                    )
                )
                parts = []
                for name in names:
                    root = ElementTree.fromstring(archive.read(name))
                    parts.append(
                        "\n".join(
                            node.text or ""
                            for node in root.iter()
                            if node.tag.endswith("}t")
                        )
                    )
                text = checked_text("\n\n".join(parts))
                return (
                    "text",
                    text.encode(),
                    "Document text extracted; images, layout and embedded objects are not included.",
                )
            parts = []
            skipped = 0
            length = 0
            for entry in archive.infolist():
                path = PurePosixPath(entry.filename)
                lower_parts = {p.lower() for p in path.parts}
                if entry.is_dir():
                    continue
                if (
                    path.is_absolute()
                    or ".." in path.parts
                    or lower_parts & SKIP_DIRECTORIES
                    or path.name.lower().startswith(".env")
                    or not (
                        path.suffix.lower() in TEXT_EXTENSIONS
                        or path.name.lower() in SPECIAL_NAMES
                    )
                ):
                    skipped += 1
                    continue
                try:
                    content = archive.read(entry).decode("utf-8-sig")
                except UnicodeDecodeError:
                    skipped += 1
                    continue
                if "\x00" in content or not content.strip():
                    skipped += 1
                    continue
                part = f"\n--- FILE: {entry.filename} ---\n{content}\n"
                length += len(part)
                if length > MAX_TEXT_CHARACTERS:
                    raise ValueError(
                        "Source archive exceeds 600,000 extracted characters. Exclude generated files or upload a smaller module. Nothing was truncated."
                    )
                parts.append(part)
            text = checked_text("\n".join(parts))
            return (
                "text",
                text.encode(),
                f"Read {len(parts)} source files; skipped {skipped} binary, generated, environment or unsupported files. Code was not executed.",
            )
    return "text", decode_text(data).encode(), "Full UTF-8 text included."


def complete_upload(user_id: str, upload_id: str) -> dict:
    root = prefix(user_id, upload_id)
    # A retry must not mutate content already referenced by a conversation.
    try:
        existing = s3().get_object(Bucket=bucket_name(), Key=root + "manifest.json")
    except ClientError as exc:
        if exc.response["Error"]["Code"] not in {"NoSuchKey", "404"}:
            raise
    else:
        try:
            manifest = json.loads(existing["Body"].read(8192))
        finally:
            existing["Body"].close()
        return {
            "objectKey": root + "manifest.json",
            "fileName": manifest["filename"],
            **manifest,
        }
    staging = root.replace("chat-attachments/", "chat-upload-staging/", 1)
    pending = json.loads(read_object(staging + "upload.json", 4096))
    data = read_object(staging + "raw", MAX_UPLOAD_BYTES)
    if len(data) != pending["size"]:
        raise ValueError("Upload is incomplete. Remove the file and upload it again.")
    try:
        kind, payload, notice = extract_file(pending["filename"], data)
    except (zipfile.BadZipFile, KeyError, ElementTree.ParseError) as exc:
        raise ValueError(
            "File could not be read. Check that its extension matches its contents and it is not corrupted."
        ) from exc
    for name, body in (("raw", data), ("content", payload)):
        s3().put_object(
            Bucket=bucket_name(),
            Key=root + name,
            Body=body,
            Tagging="chat-upload-status=unattached",
        )
    manifest = {
        "filename": pending["filename"],
        "kind": kind,
        "size": len(data),
        "characters": len(payload.decode()) if kind == "text" else 0,
        "notice": notice,
    }
    key = root + "manifest.json"
    put_json(key, manifest, unattached=True)
    s3().delete_objects(
        Bucket=bucket_name(),
        Delete={
            "Objects": [{"Key": staging + "raw"}, {"Key": staging + "upload.json"}]
        },
    )
    return {"objectKey": key, "fileName": manifest["filename"], **manifest}


def read_manifest(key: str, user_id: str | None = None) -> dict:
    # Never accept arbitrary bucket keys, even for an authenticated user.
    if not re.fullmatch(r"chat-attachments/[^/]+/[a-f0-9]{32}/manifest\.json", key):
        raise ValueError("Invalid attachment reference.")
    if user_id is not None and not key.startswith(f"chat-attachments/{user_id}/"):
        raise PermissionError("This attachment belongs to another user.")
    return json.loads(read_object(key, 8192))


def attachment_content(key: str) -> tuple[dict, bytes]:
    manifest = read_manifest(key)
    payload = read_object(
        key.removesuffix("manifest.json") + "content", MAX_UPLOAD_BYTES
    )
    return manifest, payload


def bind_attachment(key: str, user_id: str, conversation_id: str):
    """Bind once on successful persistence, so deleting one chat cannot break another."""
    read_manifest(
        key, user_id
    )  # Validate path and ownership before the conditional write.
    result = s3().get_object(Bucket=bucket_name(), Key=key)
    try:
        manifest = json.loads(result["Body"].read(8192))
    finally:
        result["Body"].close()
    owner_conversation = manifest.get("conversation_id")
    if owner_conversation and owner_conversation != conversation_id:
        raise ValueError(
            "This attachment is already used in another conversation. Upload it again for this chat."
        )
    if not owner_conversation:
        manifest["conversation_id"] = conversation_id
        try:
            s3().put_object(
                Bucket=bucket_name(),
                Key=key,
                Body=json.dumps(manifest).encode(),
                ContentType="application/json",
                IfMatch=result["ETag"],
            )
        except ClientError as exc:
            if exc.response["Error"]["Code"] in {
                "PreconditionFailed",
                "ConditionalRequestConflict",
            }:
                raise ValueError(
                    "Attachment changed while sending. Retry your message."
                ) from exc
            raise
    root = key.removesuffix("manifest.json")
    for name in ("raw", "content", "manifest.json"):
        s3().put_object_tagging(
            Bucket=bucket_name(),
            Key=root + name,
            Tagging={"TagSet": [{"Key": "chat-upload-status", "Value": "attached"}]},
        )
    manifest["retained"] = True
    put_json(key, manifest)


def delete_chat_attachments(user_id: str, conversation_id: str, keys: set[str]):
    for key in keys:
        try:
            manifest = read_manifest(key, user_id)
        except AttachmentMissingError:
            continue  # Makes deletion retryable after a partially completed delete.
        if manifest.get("conversation_id") != conversation_id:
            continue
        root = key.removesuffix("manifest.json")
        response = s3().delete_objects(
            Bucket=bucket_name(),
            Delete={
                "Objects": [
                    {"Key": root + name} for name in ("raw", "content", "manifest.json")
                ]
            },
        )
        if response.get("Errors"):
            raise RuntimeError(
                "Attachment deletion did not finish. Please retry deleting this chat."
            )


def delete_all_user_attachments(user_id: str):
    client = s3()
    for page in client.get_paginator("list_objects_v2").paginate(
        Bucket=bucket_name(), Prefix=f"chat-attachments/{user_id}/"
    ):
        objects = [{"Key": item["Key"]} for item in page.get("Contents", [])]
        if objects:
            response = client.delete_objects(
                Bucket=bucket_name(), Delete={"Objects": objects}
            )
            if response.get("Errors"):
                raise RuntimeError("Attachment deletion did not finish. Please retry.")
