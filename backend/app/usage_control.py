"""Server-enforced generation-attempt quotas and verified model registration.

DynamoDB transactions reserve all applicable request counters together. These
are application request limits, not AWS billing budgets or token/spend limits.
"""

import hashlib
import json
import os
import time
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

import boto3
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.frontier_models import FRONTIER_MODELS
from app.routes.schemas.conversation import type_model_name

BUSINESS_ZONE = ZoneInfo("Asia/Kolkata")
POLICY_KEY = {"PK": "CONFIG", "SK": "POLICY"}
MODELS_KEY = {"PK": "CONFIG", "SK": "VERIFIED_MODELS"}
_serializer, _deserializer = TypeSerializer(), TypeDeserializer()


class UsageLimitExceeded(Exception):
    pass


class UsageControlUnavailable(Exception):
    pass


class Rule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dailyRequests: int | None = Field(default=None, ge=0, le=100_000_000, strict=True)
    monthlyRequests: int | None = Field(default=None, ge=0, le=100_000_000, strict=True)
    maxOutputTokens: int | None = Field(default=None, ge=2048, le=128000, strict=True)


class ModelRule(Rule):
    enabled: bool = True
    dailyRequestsPerUser: int | None = Field(
        default=None, ge=0, le=100_000_000, strict=True
    )
    monthlyRequestsPerUser: int | None = Field(
        default=None, ge=0, le=100_000_000, strict=True
    )


class UserRule(Rule):
    allowedModels: list[type_model_name] | None = Field(default=None, max_length=100)


class UsagePolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(default=0, ge=0, strict=True)
    workspace: Rule = Field(default_factory=Rule)
    defaultUser: Rule = Field(default_factory=Rule)
    models: dict[type_model_name, ModelRule] = Field(
        default_factory=dict, max_length=100
    )
    users: dict[str, UserRule] = Field(default_factory=dict, max_length=1000)

    @field_validator("users")
    @classmethod
    def valid_user_keys(cls, users):
        normalized = {}
        for email, rule in users.items():
            key = email.strip().lower()
            if "@" not in key or len(key) > 254 or len(key.split("@")) != 2:
                raise ValueError(
                    "Use an employee's complete email address for an override."
                )
            if key in normalized:
                raise ValueError("Duplicate employee email address.")
            normalized[key] = rule
        return normalized


def wire(value):
    return {key: _serializer.serialize(v) for key, v in value.items()}


def unwire(value):
    return {key: _deserializer.deserialize(v) for key, v in value.items()}


def storage():
    name = os.environ.get("USAGE_CONTROL_TABLE_NAME")
    if not name:
        return None, None
    client = boto3.client(
        "dynamodb",
        region_name=os.environ.get("REGION", "us-east-1"),
        config=Config(connect_timeout=2, read_timeout=3, retries={"max_attempts": 1}),
    )
    return client, name


def read_item(client, name, key):
    result = client.get_item(TableName=name, Key=wire(key), ConsistentRead=True)
    return unwire(result.get("Item", {}))


def read_policy(client=None, name=None) -> UsagePolicy:
    if client is None:
        client, name = storage()
    if client is None:
        return UsagePolicy()
    item = read_item(client, name, POLICY_KEY)
    return UsagePolicy.model_validate_json(item["Policy"]) if item else UsagePolicy()


def save_policy(policy: UsagePolicy, actor: str):
    client, name = storage()
    if client is None:
        raise UsageControlUnavailable(
            "Deploy the usage controls before changing limits."
        )
    data = policy.model_copy(update={"revision": policy.revision + 1})
    encoded = data.model_dump_json()
    if len(encoded.encode()) > 200000:
        raise ValueError("The limits policy is too large.")
    try:
        client.put_item(
            TableName=name,
            Item=wire(
                {
                    **POLICY_KEY,
                    "Revision": data.revision,
                    "Policy": encoded,
                    "UpdatedAt": datetime.now(timezone.utc).isoformat(),
                    "UpdatedBy": actor,
                }
            ),
            ConditionExpression=(
                "attribute_not_exists(Revision)"
                if policy.revision == 0
                else "Revision = :revision"
            ),
            **(
                {"ExpressionAttributeValues": wire({":revision": policy.revision})}
                if policy.revision
                else {}
            ),
        )
    except ClientError as error:
        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            from app.repositories.common import ResourceConflictError

            raise ResourceConflictError(
                "Someone changed these limits. Reload before saving again."
            ) from error
        raise
    return data


def verified_models(client=None, name=None):
    if client is None:
        client, name = storage()
    if client is None:
        return {}
    return read_item(client, name, MODELS_KEY).get("Models", {})


def usable_model_record(record, *, region=None, allow_global=None, allow_geo=None):
    region = region or os.environ.get("BEDROCK_REGION", "us-east-1")
    if allow_global is None:
        allow_global = (
            os.environ.get("ENABLE_BEDROCK_GLOBAL_INFERENCE", "false") == "true"
        )
    if allow_geo is None:
        allow_geo = (
            os.environ.get("ENABLE_BEDROCK_CROSS_REGION_INFERENCE", "false") == "true"
        )
    profile = record.get("profileId", "")
    return bool(
        record.get("ready")
        and record.get("region") == region
        and (
            (profile.startswith("global.") and allow_global)
            or (profile.startswith("us.") and allow_geo)
        )
    )


def effective_models(base_models: list[str]):
    """Never expose a newly integrated candidate before its application-role test."""
    if not os.environ.get("USAGE_CONTROL_TABLE_NAME"):
        return base_models
    records = verified_models()
    if not base_models:
        from typing import get_args

        base_models = list(get_args(type_model_name))
    baseline = [model for model in base_models if model not in FRONTIER_MODELS]
    return list(
        dict.fromkeys(
            baseline
            + [
                key
                for key, value in records.items()
                if key in FRONTIER_MODELS and usable_model_record(value)
            ]
        )
    )


def subject_key(subject: str):
    return hashlib.sha256(subject.encode()).hexdigest()


def effective_user_rule(policy: UsagePolicy, email: str):
    override = policy.users.get(email.strip().lower(), UserRule())
    values = policy.defaultUser.model_dump()
    values.update(
        {
            key: value
            for key, value in override.model_dump().items()
            if value is not None
        }
    )
    return UserRule.model_validate(values)


def allowed_for_user(policy: UsagePolicy, email: str, models: list[str]):
    allowed = effective_user_rule(policy, email).allowedModels
    return [
        model
        for model in models
        if policy.models.get(model, ModelRule()).enabled
        and (allowed is None or model in allowed)
    ]


def scopes(policy, subject, email, model):
    mr = policy.models.get(model, ModelRule())
    ur = effective_user_rule(policy, email)
    if not mr.enabled or (
        ur.allowedModels is not None and model not in ur.allowedModels
    ):
        raise PermissionError(
            "This model is not enabled for your employee account. Contact your workspace administrator."
        )
    return [
        ("WORKSPACE", "Workspace", policy.workspace),
        (f"USER#{subject_key(subject)}", "Your account", ur),
        (f"MODEL#{model}", "This model across the workspace", mr),
        (
            f"USER_MODEL#{subject_key(subject)}#{model}",
            "Your account on this model",
            Rule(
                dailyRequests=mr.dailyRequestsPerUser,
                monthlyRequests=mr.monthlyRequestsPerUser,
            ),
        ),
    ]


def reserve_generation(user, model: str, *, client=None, table_name=None, now=None):
    """Count admitted attempts once, before retrieval or model/tool execution.

    Failed/stopped requests still count. Tool-loop calls are
    not additional attempts; titles use no model; maxOutputTokens applies separately to each model call.
    """
    if client is None:
        client, table_name = storage()
    if client is None:
        if model in FRONTIER_MODELS:
            raise PermissionError(
                "Deploy the workspace runtime access check before using this model."
            )
        return None
    if model in FRONTIER_MODELS and not usable_model_record(
        verified_models(client, table_name).get(model, {})
    ):
        raise PermissionError(
            "This model has not passed the workspace's runtime access check."
        )
    stamp = (now or datetime.now(timezone.utc)).astimezone(BUSINESS_ZONE)
    periods = [
        ("day", stamp.strftime("%Y-%m-%d"), "dailyRequests"),
        ("month", stamp.strftime("%Y-%m"), "monthlyRequests"),
    ]
    for attempt in range(3):
        policy = read_policy(client, table_name)
        applicable = scopes(policy, user.id, user.email, model)
        transaction = [
            {
                "ConditionCheck": {
                    "TableName": table_name,
                    "Key": wire(POLICY_KEY),
                    "ConditionExpression": (
                        "attribute_not_exists(Revision)"
                        if policy.revision == 0
                        else "Revision = :revision"
                    ),
                    **(
                        {
                            "ExpressionAttributeValues": wire(
                                {":revision": policy.revision}
                            )
                        }
                        if policy.revision
                        else {}
                    ),
                }
            }
        ]
        descriptions = [None]
        for key, label, rule in applicable:
            for period, value, field in periods:
                cap = getattr(rule, field)
                if cap == 0:
                    raise UsageLimitExceeded(
                        f"{label}: no {period} requests are available. Contact your workspace administrator."
                    )
                item = {
                    "TableName": table_name,
                    "Key": wire({"PK": key, "SK": f"{period.upper()}#{value}"}),
                    "UpdateExpression": "SET #count = if_not_exists(#count, :zero) + :one, ExpiresAt = :expiry",
                    "ExpressionAttributeNames": {"#count": "RequestCount"},
                    "ExpressionAttributeValues": wire(
                        {
                            ":zero": 0,
                            ":one": 1,
                            ":expiry": int(stamp.timestamp()) + 100 * 86400,
                        }
                    ),
                }
                if cap is not None:
                    item["ConditionExpression"] = (
                        "attribute_not_exists(#count) OR #count < :cap"
                    )
                    item["ExpressionAttributeValues"][":cap"] = _serializer.serialize(
                        cap
                    )
                transaction.append({"Update": item})
                descriptions.append((label, period, value, cap))
        transaction.append(
            {
                "Put": {
                    "TableName": table_name,
                    "Item": wire(
                        {
                            "PK": "EMAIL#" + user.email.strip().lower(),
                            "SK": "SUBJECT",
                            "Subject": user.id,
                        }
                    ),
                }
            }
        )
        try:
            client.transact_write_items(
                TransactItems=transaction, ClientRequestToken=str(uuid4())
            )
            limits = [
                rule.maxOutputTokens
                for _, _, rule in applicable
                if rule.maxOutputTokens is not None
            ]
            return min(limits) if limits else None
        except ClientError as error:
            code = error.response["Error"]["Code"]
            reasons = error.response.get("CancellationReasons", [])
            if code == "TransactionCanceledException":
                for index, reason in enumerate(reasons[1 : len(descriptions)], 1):
                    if reason.get("Code") == "ConditionalCheckFailed":
                        label, period, value, cap = descriptions[index]
                        raise UsageLimitExceeded(
                            f"{label}: {period} request limit ({cap}) reached for {value}. Limits reset in Asia/Kolkata. Contact your workspace administrator."
                        ) from error
                retryable = (
                    reasons and reasons[0].get("Code") == "ConditionalCheckFailed"
                ) or any(
                    reason.get("Code") == "TransactionConflict" for reason in reasons
                )
                if retryable:
                    time.sleep(0.03 * (attempt + 1))
                    continue
            if code == "TransactionConflictException":
                time.sleep(0.03 * (attempt + 1))
                continue
            raise UsageControlUnavailable(
                "Usage limits could not be verified. Please retry shortly; no model request was started."
            ) from error
        except BotoCoreError as error:
            raise UsageControlUnavailable(
                "Usage limits could not be verified. Please retry shortly; no model request was started."
            ) from error
    raise UsageControlUnavailable(
        "Usage limits changed while this request was starting. Please retry."
    )


def usage_snapshot(
    subject: str | None,
    email: str,
    model: str,
    *,
    client=None,
    table_name=None,
    now=None,
):
    if client is None:
        client, table_name = storage()
    policy = read_policy(client, table_name) if client else UsagePolicy()
    stamp = (now or datetime.now(timezone.utc)).astimezone(BUSINESS_ZONE)
    rows = []
    # Reporting remains available for a now-disabled model/account.
    safe_policy = policy.model_copy(deep=True)
    safe_policy.models.setdefault(model, ModelRule()).enabled = True
    safe_policy.users.setdefault(email.strip().lower(), UserRule()).allowedModels = None
    for key, label, rule in scopes(
        safe_policy, subject or "not-yet-used", email, model
    ):
        counts = {}
        for period, value in [
            ("day", stamp.strftime("%Y-%m-%d")),
            ("month", stamp.strftime("%Y-%m")),
        ]:
            item = (
                read_item(
                    client, table_name, {"PK": key, "SK": f"{period.upper()}#{value}"}
                )
                if client
                else {}
            )
            counts[period] = int(item.get("RequestCount", 0))
        rows.append(
            {
                "scope": label,
                "day": counts["day"],
                "month": counts["month"],
                **rule.model_dump(),
            }
        )
    return {
        "timezone": "Asia/Kolkata",
        "day": stamp.strftime("%Y-%m-%d"),
        "month": stamp.strftime("%Y-%m"),
        "model": model,
        "scopes": rows,
        "configured": client is not None,
        "notice": "Counts include admitted generation attempts, including stopped or failed requests. Counters start with the usage-control release. These are not token or dollar budgets.",
    }
