import os
from fastapi import APIRouter, Request
from app.usage_control import read_policy, allowed_for_user

from app.usecases.global_config import (
    get_logo_path,
    get_global_available_models,
    get_default_model,
)

router = APIRouter(tags=["config"])


@router.get("/config/global")
def get_global_config(request: Request):
    """Get global configuration including available models."""
    global_models = get_global_available_models()
    if global_models:
        global_models = allowed_for_user(
            read_policy(), request.state.current_user.email, global_models
        )
    default_model = get_default_model()
    logo_path = get_logo_path()
    return {
        "globalAvailableModels": global_models,
        "modelAccessConfigured": bool(os.environ.get("USAGE_CONTROL_TABLE_NAME"))
        or bool(global_models),
        "defaultModel": default_model,
        "logoPath": logo_path,
    }
