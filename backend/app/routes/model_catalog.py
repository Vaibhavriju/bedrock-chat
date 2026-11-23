from app.dependencies import check_admin
from app.model_catalog import get_model_catalog
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException

router = APIRouter(tags=["admin"])


@router.get("/admin/models", dependencies=[Depends(check_admin)])
def read_model_catalog():
    try:
        return get_model_catalog()
    except (ClientError, BotoCoreError):
        raise HTTPException(
            status_code=503,
            detail="The Bedrock catalog is temporarily unavailable. Check the application role's Bedrock read permissions and retry.",
        )
