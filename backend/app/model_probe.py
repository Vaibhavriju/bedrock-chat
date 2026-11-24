"""IAM-only bounded inference checks using the production WebSocket execution role.

No public route, arbitrary prompt/model input, subscription, or agreement API.
Only passing profiles are registered in the workspace's model allowlist.
"""

import json
import os
from datetime import datetime, timezone
from time import time
from uuid import uuid4

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.frontier_models import FRONTIER_MODELS
from app.usage_control import MODELS_KEY, read_item, storage, wire

SUITE = "frontier-2026-11-24-v1"
JOB_KEY = {"PK": "PROBE", "SK": SUITE}


def probe_profile(key, profile_id):
    from app.repositories.models.conversation import (
        SimpleMessageModel,
        TextContentModel,
    )
    from app.repositories.models.custom_bot import GenerationParamsModel
    from app.routes.schemas.conversation import ChatInput, MessageInput, TextContent
    from app.strands_integration.chat_strands import converse_with_strands

    config = Config(connect_timeout=5, read_timeout=30, retries={"max_attempts": 0})
    generation = GenerationParamsModel(max_tokens=1024)
    request = ChatInput(
        conversation_id="iam-only-frontier-probe",
        enable_reasoning=True,
        message=MessageInput(
            role="user",
            model=key,
            parent_message_id="system",
            content=[TextContent(content_type="text", body="Reply with READY only.")],
        ),
    )
    messages = [
        SimpleMessageModel(
            role="user",
            content=[
                TextContentModel(content_type="text", body="Reply with READY only.")
            ],
        )
    ]
    calls = []
    for turn in range(2):
        streamed = []
        result = converse_with_strands(
            bot=None,
            chat_input=request,
            instructions=[],
            generation_params=generation,
            guardrail=None,
            display_citation=False,
            messages=messages,
            search_results=[],
            on_stream=streamed.append,
            runtime_model_id=profile_id,
            model_client_config=config,
        )
        text = "".join(
            content.body
            for content in result["message"].content
            if isinstance(content, TextContentModel)
        )
        if (
            not "".join(streamed).strip()
            or not text.strip()
            or result["stop_reason"] != "end_turn"
        ):
            raise ValueError(
                "No complete streamed answer was returned within the bounded probe."
            )
        calls.append(
            {
                "turn": turn + 1,
                "reply": text[:100],
                "streamed": True,
                "inputTokens": result["input_token_count"],
                "outputTokens": result["output_token_count"],
            }
        )
        messages.extend(
            [
                SimpleMessageModel.from_message_model(result["message"]),
                SimpleMessageModel(
                    role="user",
                    content=[
                        TextContentModel(
                            content_type="text", body="Reply with READY again."
                        )
                    ],
                ),
            ]
        )
    return calls


def handler(event, context):
    if not isinstance(event, dict) or set(event) - {"enableSuccessful", "force"}:
        raise ValueError("Only the bounded frontier probe options are accepted.")
    if any(not isinstance(value, bool) for value in event.values()):
        raise ValueError("Probe options must be booleans.")
    enable = event.get("enableSuccessful", False)
    client, table = storage()
    if client is None:
        raise ValueError("Usage/model registration storage has not been deployed.")
    region = os.environ.get("BEDROCK_REGION", "us-east-1")
    if region not in {"us-east-1", "us-east-2", "us-west-2"}:
        raise ValueError(
            "This reviewed integration expects a supported US source Region."
        )
    allow_global = os.environ.get("ENABLE_BEDROCK_GLOBAL_INFERENCE", "false") == "true"
    allow_geo = (
        os.environ.get("ENABLE_BEDROCK_CROSS_REGION_INFERENCE", "false") == "true"
    )
    routing = {"region": region, "global": allow_global, "geo": allow_geo}
    configuration = json.dumps(routing, sort_keys=True)
    job = read_item(client, table, JOB_KEY)
    if (
        not event.get("force")
        and job.get("Status") == "COMPLETE"
        and job.get("EnabledSuccessful") == enable
        and job.get("Configuration") == configuration
    ):
        return {**json.loads(job["Result"]), "cached": True}
    now = int(time())
    run_id = uuid4().hex
    try:
        client.put_item(
            TableName=table,
            Item=wire(
                {
                    **JOB_KEY,
                    "Status": "RUNNING",
                    "RunId": run_id,
                    "RunUntil": now + 660,
                    "Configuration": configuration,
                }
            ),
            ConditionExpression="(attribute_not_exists(RunUntil) OR RunUntil < :now)"
            + (
                ""
                if event.get("force")
                else " AND (attribute_not_exists(#status) OR #status <> :complete OR EnabledSuccessful <> :enable OR Configuration <> :configuration)"
            ),
            **(
                {"ExpressionAttributeNames": {"#status": "Status"}}
                if not event.get("force")
                else {}
            ),
            ExpressionAttributeValues=wire(
                {
                    ":now": now,
                    **(
                        {
                            ":complete": "COMPLETE",
                            ":enable": enable,
                            ":configuration": configuration,
                        }
                        if not event.get("force")
                        else {}
                    ),
                }
            ),
        )
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            latest = read_item(client, table, JOB_KEY)
            if (
                latest.get("Status") == "COMPLETE"
                and latest.get("EnabledSuccessful") == enable
                and latest.get("Configuration") == configuration
            ):
                return {**json.loads(latest["Result"]), "cached": True}
            return {
                "status": "IN_PROGRESS",
                "notice": "The bounded application-role probe is already running.",
            }
        raise

    prefixes = (["global."] if allow_global else []) + (["us."] if allow_geo else [])
    control = boto3.client(
        "bedrock",
        region_name=region,
        config=Config(connect_timeout=3, read_timeout=5, retries={"max_attempts": 0}),
    )
    records = read_item(client, table, MODELS_KEY).get("Models", {})
    results = []
    for key, model_id in FRONTIER_MODELS.items():
        checked_at = datetime.now(timezone.utc).isoformat()
        row = {
            "appKey": key,
            "modelId": model_id,
            "ready": False,
            "checkedAt": checked_at,
            "region": region,
            "attempts": [],
        }
        try:
            availability = control.get_foundation_model_availability(modelId=model_id)
            row["access"] = {
                key: availability.get(key)
                for key in [
                    "authorizationStatus",
                    "entitlementAvailability",
                    "regionAvailability",
                    "agreementAvailability",
                ]
            }
        except Exception:
            row["access"] = None
        # Metadata may lag new account entitlements. Actual bounded inference is
        # authoritative; no agreement/subscription APIs are called here.
        if not prefixes:
            row["attempts"].append(
                {
                    "error": "No reviewed inference route is enabled in this deployment. Routing settings were preserved."
                }
            )
        for prefix in prefixes:
            if context and context.get_remaining_time_in_millis() < 50000:
                row["attempts"].append(
                    {"error": "Probe deadline approached; rerun with force to retry."}
                )
                break
            profile = prefix + model_id
            try:
                turns = probe_profile(key, profile)
                row.update(
                    {
                        "passed": True,
                        "ready": bool(enable or records.get(key, {}).get("ready")),
                        "profileId": profile,
                        "checks": turns,
                    }
                )
                break
            except Exception as error:
                code = (
                    error.response.get("Error", {}).get("Code", type(error).__name__)
                    if isinstance(error, ClientError)
                    else type(error).__name__
                )
                row["attempts"].append(
                    {"profileId": profile, "errorCode": code, "error": str(error)[:800]}
                )
        records[key] = row
        results.append(row)
        client.put_item(TableName=table, Item=wire({**MODELS_KEY, "Models": records}))
    result = {
        "status": "COMPLETE",
        "region": region,
        "executionRole": os.environ.get("APPLICATION_ROLE_ARN", ""),
        "routing": routing,
        "suite": SUITE,
        "cached": False,
        "models": results,
        "enabled": [row["appKey"] for row in results if row["ready"]],
        "notice": "Successful checks used the production chat execution role and the app's Strands adapter, streaming, reasoning and a follow-up turn. Test calls may be billable. This does not confirm Activate eligibility.",
    }
    client.put_item(
        TableName=table,
        Item=wire(
            {
                **JOB_KEY,
                "Status": "COMPLETE",
                "RunUntil": 0,
                "RunId": run_id,
                "EnabledSuccessful": enable,
                "Configuration": configuration,
                "Result": json.dumps(result),
            }
        ),
        ConditionExpression="RunId = :run",
        ExpressionAttributeValues=wire({":run": run_id}),
    )
    return result
