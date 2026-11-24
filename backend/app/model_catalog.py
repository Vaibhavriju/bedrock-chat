"""Read-only model discovery. Metadata is never presented as an inference test."""

import copy
import logging
import os
import threading
import time
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.bedrock import BASE_MODEL_IDS
from app.usecases.global_config import get_global_available_models
from app.usage_control import verified_models

logger = logging.getLogger(__name__)
_lock = threading.Lock()
_cache: tuple[float, dict] | None = None
_TTL = 300
# These are discovery candidates, not enabled application models.
CANDIDATES = {
    "anthropic.claude-sonnet-5-5",
    "anthropic.claude-opus-5-5",
    "anthropic.claude-haiku-5-5",
    "amazon.nova-2-lite-v1:0",
    "openai.gpt-6.2-sol",
    "openai.gpt-6.2-astra",
}


def build_catalog(client, region: str) -> dict:
    foundation_models = client.list_foundation_models(byOutputModality="TEXT").get(
        "modelSummaries", []
    )
    profiles: dict[str, set[str]] = {}
    next_token = None
    page_count = 0
    warnings = []
    try:
        while True:
            args = {"nextToken": next_token} if next_token else {}
            page = client.list_inference_profiles(**args)
            for profile in page.get("inferenceProfileSummaries", []):
                if profile.get("status") != "ACTIVE":
                    continue
                for model in profile.get("models", []):
                    model_id = model.get("modelArn", "").rsplit("/", 1)[-1]
                    profiles.setdefault(model_id, set()).add(
                        profile["inferenceProfileId"]
                    )
            next_token = page.get("nextToken")
            page_count += 1
            if not next_token:
                break
            if page_count >= 5:
                warnings.append(
                    "Inference profile results reached the page limit; this catalog may be incomplete."
                )
                break
    except (ClientError, BotoCoreError):
        logger.warning("Inference profile discovery failed")
        warnings.append(
            "Inference profiles could not be checked. Ask an administrator to review Bedrock read permissions."
        )

    app_keys = {value: key for key, value in BASE_MODEL_IDS.items()}
    configured = get_global_available_models()
    tested = verified_models()
    wanted = sorted(
        {
            m["modelId"]
            for m in foundation_models
            if m["modelId"] in CANDIDATES
            or (
                app_keys.get(m["modelId"])
                and (not configured or app_keys[m["modelId"]] in configured)
            )
        },
        key=lambda model_id: (model_id not in CANDIDATES, model_id),
    )[:12]

    def check_metadata(model_id):
        try:
            return model_id, client.get_foundation_model_availability(modelId=model_id)
        except (ClientError, BotoCoreError, AttributeError):
            return model_id, None

    with ThreadPoolExecutor(max_workers=4) as executor:
        metadata = dict(executor.map(check_metadata, wanted))
    rows = []
    for model in foundation_models:
        if "TEXT" not in model.get("outputModalities", []):
            continue
        model_id = model["modelId"]
        key = app_keys.get(model_id)
        enabled = key is not None and (not configured or key in configured)
        access = "not_checked"
        detail = "Catalog listing only; invocation has not been tested."
        # Bound the number of extra API requests. No invocation or subscription calls.
        if model_id in metadata:
            try:
                availability = metadata[model_id]
                agreement = availability.get("agreementAvailability", {}).get("status")
                states = [
                    availability.get("authorizationStatus"),
                    availability.get("entitlementAvailability"),
                    availability.get("regionAvailability"),
                ]
                if agreement == "PENDING":
                    access = "pending"
                elif any(s in ("NOT_AUTHORIZED", "NOT_AVAILABLE") for s in states):
                    access = "restricted"
                elif agreement in ("NOT_AVAILABLE", "ERROR"):
                    access = "agreement_required"
                elif (
                    all(s in ("AUTHORIZED", "AVAILABLE") for s in states)
                    and agreement == "AVAILABLE"
                ):
                    access = "metadata_available"
                else:
                    access = "unknown"
                detail = "Access metadata for the application role; a successful inference test is still required."
            except (ClientError, BotoCoreError, AttributeError):
                access = "unknown"
                detail = "Access metadata could not be checked. Listing a model does not confirm access."
        rows.append(
            {
                "id": model_id,
                "name": model.get("modelName", model_id),
                "provider": model.get("providerName", "Unknown"),
                "lifecycle": model.get("modelLifecycle", {}).get("status", "UNKNOWN"),
                "streaming": bool(model.get("responseStreamingSupported")),
                "appKey": key,
                "configured": enabled,
                "candidate": model_id in CANDIDATES,
                "profileIds": sorted(profiles.get(model_id, set())),
                "access": access,
                "runtimeTest": tested.get(key),
                "detail": detail,
            }
        )
    return {
        "region": region,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "models": sorted(
            rows,
            key=lambda row: (
                not row["configured"],
                not row["candidate"],
                row["provider"],
                row["name"],
            ),
        ),
        "warnings": warnings,
        "notice": "Read-only catalog for the application role. This does not invoke models, accept model terms, enable models or verify Activate credit coverage.",
    }


def get_model_catalog(force: bool = False) -> dict:
    global _cache
    with _lock:
        if not force and _cache and time.monotonic() - _cache[0] < _TTL:
            return copy.deepcopy(_cache[1])
        region = os.environ.get("BEDROCK_REGION", "us-east-1")
        client = boto3.client(
            "bedrock",
            region_name=region,
            config=Config(
                connect_timeout=2, read_timeout=3, retries={"max_attempts": 0}
            ),
        )
        result = build_catalog(client, region)
        _cache = (time.monotonic(), result)
        return copy.deepcopy(result)
