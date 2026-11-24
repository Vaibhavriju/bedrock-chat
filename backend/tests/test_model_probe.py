import json
from threading import Lock
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError

from app import model_probe as probe
from app.frontier_models import FRONTIER_MODELS
from app.usage_control import wire, unwire


class ProbeStore:
    def __init__(self):
        self.items = {}
        self.lock = Lock()

    def get_item(self, TableName, Key, ConsistentRead):
        key = unwire(Key)
        value = self.items.get((key["PK"], key["SK"]))
        return {"Item": wire(value)} if value else {}

    def put_item(
        self,
        TableName,
        Item,
        ConditionExpression=None,
        ExpressionAttributeValues=None,
        **kwargs
    ):
        value = unwire(Item)
        key = (value["PK"], value["SK"])
        args = unwire(ExpressionAttributeValues or {})
        with self.lock:
            old = self.items.get(key, {})
            if (
                ConditionExpression
                and "RunUntil" in ConditionExpression
                and old.get("RunUntil", -1) >= args[":now"]
            ):
                raise ClientError(
                    {"Error": {"Code": "ConditionalCheckFailedException"}}, "PutItem"
                )
            if ConditionExpression == "RunId = :run":
                assert old.get("RunId") == args[":run"]
            self.items[key] = value


@pytest.fixture
def env(monkeypatch):
    store = ProbeStore()
    monkeypatch.setattr(probe, "storage", lambda: (store, "synthetic"))
    control = Mock()
    control.get_foundation_model_availability.return_value = {
        "authorizationStatus": "AUTHORIZED",
        "agreementAvailability": {"status": "NOT_AVAILABLE"},
    }
    monkeypatch.setattr(probe.boto3, "client", lambda *args, **kwargs: control)
    monkeypatch.setenv("ENABLE_BEDROCK_GLOBAL_INFERENCE", "true")
    monkeypatch.setenv("ENABLE_BEDROCK_CROSS_REGION_INFERENCE", "true")
    monkeypatch.setenv("BEDROCK_REGION", "us-east-1")
    invoke = Mock(
        return_value=[{"turn": 1, "streamed": True}, {"turn": 2, "streamed": True}]
    )
    monkeypatch.setattr(probe, "probe_profile", invoke)
    return store, invoke


def test_actual_inference_not_stale_agreement_metadata_controls_enabling(env):
    store, invoke = env
    result = probe.handler({"enableSuccessful": True}, None)
    assert result["status"] == "COMPLETE"
    assert set(result["enabled"]) == set(FRONTIER_MODELS)
    assert invoke.call_count == len(FRONTIER_MODELS)
    records = store.items[("CONFIG", "VERIFIED_MODELS")]["Models"]
    assert all(
        row["ready"] and row["checks"][1]["turn"] == 2 for row in records.values()
    )
    assert all(row["profileId"].startswith("global.") for row in records.values())


def test_failed_models_are_not_enabled_and_exact_errors_are_retained(env):
    store, invoke = env
    denied = "claude-v5.5-opus"

    def call(key, profile):
        if key == denied:
            raise ClientError(
                {
                    "Error": {
                        "Code": "AccessDeniedException",
                        "Message": "Model is not available for this account.",
                    }
                },
                "ConverseStream",
            )
        return [{"turn": 1}, {"turn": 2}]

    invoke.side_effect = call
    result = probe.handler({"enableSuccessful": True}, None)
    assert denied not in result["enabled"]
    row = store.items[("CONFIG", "VERIFIED_MODELS")]["Models"][denied]
    assert row["ready"] is False
    assert len(row["attempts"]) == 2
    assert row["attempts"][0]["errorCode"] == "AccessDeniedException"


def test_a_working_us_profile_is_selected_when_global_is_not_available(env):
    store, invoke = env

    def call(key, profile):
        if profile.startswith("global."):
            raise ClientError(
                {
                    "Error": {
                        "Code": "AccessDeniedException",
                        "Message": "Global unavailable",
                    }
                },
                "ConverseStream",
            )
        return [{"turn": 1}, {"turn": 2}]

    invoke.side_effect = call
    result = probe.handler({"enableSuccessful": True}, None)
    assert all(row["profileId"].startswith("us.") for row in result["models"])


def test_rerunning_completed_probe_reuses_results_without_new_inference(env):
    store, invoke = env
    first = probe.handler({"enableSuccessful": True}, None)
    invoke.reset_mock()
    repeated = probe.handler({"enableSuccessful": True}, None)
    assert repeated["cached"] is True
    assert repeated["enabled"] == first["enabled"]
    invoke.assert_not_called()


def test_check_without_enable_does_not_expose_models(env):
    store, invoke = env
    result = probe.handler({}, None)
    assert not result["enabled"]
    assert all(row["passed"] and not row["ready"] for row in result["models"])


def test_a_concurrent_probe_cannot_start_another_set_of_inference_calls(env):
    store, invoke = env
    store.items[("PROBE", probe.SUITE)] = {"Status": "RUNNING", "RunUntil": 9999999999}
    assert probe.handler({"enableSuccessful": True}, None)["status"] == "IN_PROGRESS"
    invoke.assert_not_called()


def test_probe_deadline_leaves_untested_models_disabled(env):
    store, invoke = env
    context = SimpleNamespace(get_remaining_time_in_millis=lambda: 40000)
    result = probe.handler({"enableSuccessful": True}, context)
    assert not result["enabled"]
    invoke.assert_not_called()


@pytest.mark.parametrize(
    "event",
    [{"prompt": "Arbitrary prompt"}, {"models": ["arbitrary"]}, {"force": "yes"}],
)
def test_probe_rejects_arbitrary_model_prompt_or_untyped_options(event):
    with pytest.raises(ValueError):
        probe.handler(event, None)


def test_probe_respects_disabled_cross_region_routes_instead_of_widening_them(
    env, monkeypatch
):
    store, invoke = env
    monkeypatch.setenv("ENABLE_BEDROCK_GLOBAL_INFERENCE", "false")
    monkeypatch.setenv("ENABLE_BEDROCK_CROSS_REGION_INFERENCE", "false")
    result = probe.handler({"enableSuccessful": True}, None)
    assert result["enabled"] == []
    invoke.assert_not_called()
