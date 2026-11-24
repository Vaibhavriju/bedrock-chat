import json
import logging
import os

from app.routes.schemas.conversation import type_model_name

logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s - %(message)s")
logger = logging.getLogger(__name__)

GLOBAL_AVAILABLE_MODELS = os.environ.get("GLOBAL_AVAILABLE_MODELS")
DEFAULT_MODEL = os.environ.get("DEFAULT_MODEL")
TITLE_MODEL = os.environ.get("TITLE_MODEL")
LOGO_PATH = os.environ.get("LOGO_PATH", "")


def get_global_available_models() -> list[str]:
    """The configured baseline plus candidates verified by the production role."""
    from app.usage_control import effective_models, UsageControlUnavailable

    models = []
    if GLOBAL_AVAILABLE_MODELS:
        try:
            configured = json.loads(GLOBAL_AVAILABLE_MODELS)
            if not isinstance(configured, list) or any(
                not isinstance(model, str) for model in configured
            ):
                raise ValueError("Expected a string list")
            models = [model for model in configured if model]
        except (json.JSONDecodeError, ValueError) as error:
            raise UsageControlUnavailable(
                "The workspace model allowlist needs administrator review."
            ) from error
    return effective_models(models)


def get_default_model() -> type_model_name:
    """Return the configured default model, falling back to claude-v4.6-sonnet."""
    return (DEFAULT_MODEL or "").strip() or "claude-v4.6-sonnet"  # type: ignore[return-value]


def get_title_model() -> type_model_name:
    """Return the model for title generation.

    Falls back to: TITLE_MODEL -> DEFAULT_MODEL -> claude-v3-haiku
    """
    return (TITLE_MODEL or "").strip() or (DEFAULT_MODEL or "").strip() or "claude-v3-haiku"  # type: ignore[return-value]


def get_logo_path() -> str:
    """Return the configured drawer logo path."""
    return LOGO_PATH
