from fastapi import APIRouter, Request, Response
import base64
from pydantic import Field

from urllib.parse import quote
from app.attachments import (
    attachment_content,
    bucket_name,
    complete_upload,
    create_upload,
    prefix,
    read_manifest,
    s3,
)
from app.routes.schemas.base import BaseSchema

router = APIRouter(tags=["conversation"])


class UploadInput(BaseSchema):
    filename: str = Field(min_length=1, max_length=240)
    size: int = Field(gt=0, le=25 * 1024 * 1024)


@router.post("/attachments/uploads")
def start_upload(request: Request, data: UploadInput):
    return create_upload(request.state.current_user.id, data.filename, data.size)


@router.post("/attachments/uploads/{upload_id}/complete")
def finish_upload(request: Request, upload_id: str):
    return complete_upload(request.state.current_user.id, upload_id)


@router.get("/attachments/{upload_id}")
def preview_upload(request: Request, upload_id: str):
    root = prefix(request.state.current_user.id, upload_id)
    manifest = read_manifest(root + "manifest.json", request.state.current_user.id)
    preview = None
    if manifest["kind"] == "text":
        _, payload = attachment_content(root + "manifest.json")
        text = payload.decode("utf-8")
        preview = text[:20_000]
    url = s3().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": bucket_name(),
            "Key": root + "raw",
            "ResponseContentDisposition": f"attachment; filename*=UTF-8''{quote(manifest['filename'], safe='')}",
        },
        ExpiresIn=300,
    )
    return {
        **manifest,
        "preview": preview,
        "previewTruncated": manifest["characters"] > 20_000,
        "downloadUrl": url,
    }


@router.get("/attachments/{upload_id}/text")
def export_upload_text(request: Request, upload_id: str, response: Response):
    """Return the owner's complete extracted text, without signed URLs or S3 keys."""
    response.headers["Cache-Control"] = "private, no-store"
    root = prefix(request.state.current_user.id, upload_id)
    manifest = read_manifest(root + "manifest.json", request.state.current_user.id)
    text = None
    if manifest["kind"] == "text":
        _, payload = attachment_content(root + "manifest.json")
        text = base64.b64encode(payload).decode("ascii")
    return {
        "filename": manifest["filename"],
        "kind": manifest["kind"],
        "characters": manifest["characters"],
        "notice": manifest.get("notice", ""),
        "textBase64": text,
    }
