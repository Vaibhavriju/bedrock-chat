import json
from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from botocore.exceptions import ClientError
from pydantic import ValidationError

from app import usage_control as u


class AtomicStore:
    """No-network transaction fixture: validate every condition before committing.

    Tests the client's all-or-nothing request contract. AWS integration testing
    is still needed for the deployed table/IAM path.
    """

    def __init__(self, policy=None):
        self.items = {}
        self.lock = Lock()
        self.transactions = []
        if policy is not None:
            self.items[("CONFIG", "POLICY")] = {
                **u.POLICY_KEY,
                "Revision": policy.revision,
                "Policy": policy.model_dump_json(),
            }

    def get_item(self, TableName, Key, ConsistentRead):
        assert ConsistentRead is True
        key = u.unwire(Key)
        with self.lock:
            item = self.items.get((key["PK"], key["SK"]))
            return {"Item": u.wire(deepcopy(item))} if item else {}

    def transact_write_items(self, TransactItems, ClientRequestToken):
        assert len(ClientRequestToken) == 36
        with self.lock:
            self.transactions.append(TransactItems)
            reasons = [{"Code": "None"} for _ in TransactItems]
            updates = []
            for i, operation in enumerate(TransactItems):
                name, item = next(iter(operation.items()))
                if name == "Put":
                    value = u.unwire(item["Item"])
                    updates.append(((value["PK"], value["SK"]), value))
                    continue
                key = u.unwire(item["Key"])
                value = deepcopy(self.items.get((key["PK"], key["SK"]), key))
                values = u.unwire(item.get("ExpressionAttributeValues", {}))
                if name == "ConditionCheck":
                    valid = (
                        (value.get("Revision") == values[":revision"])
                        if ":revision" in values
                        else "Revision" not in value
                    )
                    if not valid:
                        reasons[i] = {"Code": "ConditionalCheckFailed"}
                else:
                    assert (
                        item["UpdateExpression"]
                        == "SET #count = if_not_exists(#count, :zero) + :one, ExpiresAt = :expiry"
                    )
                    if (
                        ":cap" in values
                        and value.get("RequestCount", 0) >= values[":cap"]
                    ):
                        reasons[i] = {"Code": "ConditionalCheckFailed"}
                    value["RequestCount"] = value.get("RequestCount", 0) + 1
                    value["ExpiresAt"] = values[":expiry"]
                    updates.append(((key["PK"], key["SK"]), value))
            if any(reason["Code"] != "None" for reason in reasons):
                raise ClientError(
                    {
                        "Error": {"Code": "TransactionCanceledException"},
                        "CancellationReasons": reasons,
                    },
                    "TransactWriteItems",
                )
            self.items.update(updates)


USER = SimpleNamespace(id="signed-in-subject", email="Person@batterypool.com")
MODEL = "claude-v4.6-sonnet"
NOW = datetime(2026, 11, 24, 8, 0, tzinfo=timezone.utc)


def reserve(store, user=USER, model=MODEL, now=NOW):
    return u.reserve_generation(
        user, model, client=store, table_name="synthetic", now=now
    )


def test_simultaneous_requests_cannot_bypass_the_employee_cap_or_partially_increment_shared_counters():
    policy = u.UsagePolicy(revision=1, defaultUser=u.Rule(dailyRequests=3))
    store = AtomicStore(policy)

    def send(_):
        try:
            reserve(store)
            return True
        except u.UsageLimitExceeded:
            return False

    with ThreadPoolExecutor(max_workers=12) as pool:
        assert sum(pool.map(send, range(12))) == 3
    assert store.items[("WORKSPACE", "DAY#2026-11-24")]["RequestCount"] == 3
    assert store.items[("MODEL#" + MODEL, "MONTH#2026-11")]["RequestCount"] == 3


def test_shared_model_cap_applies_across_different_employees():
    store = AtomicStore(
        u.UsagePolicy(revision=1, models={MODEL: u.ModelRule(dailyRequests=1)})
    )
    reserve(store)
    with pytest.raises(u.UsageLimitExceeded, match="model across the workspace"):
        reserve(store, user=SimpleNamespace(id="other", email="other@batterypool.com"))
    assert ("USER#" + u.subject_key("other"), "DAY#2026-11-24") not in store.items


def test_employee_model_cap_does_not_block_their_other_models():
    store = AtomicStore(
        u.UsagePolicy(revision=1, models={MODEL: u.ModelRule(dailyRequestsPerUser=1)})
    )
    reserve(store)
    with pytest.raises(u.UsageLimitExceeded, match="Your account on this model"):
        reserve(store)
    reserve(store, model="claude-v4.5-haiku")


def test_individual_override_inherits_blanks_and_can_never_bypass_workspace_cap():
    policy = u.UsagePolicy(
        revision=1,
        workspace=u.Rule(monthlyRequests=2),
        defaultUser=u.Rule(dailyRequests=1, maxOutputTokens=4096),
        users={"person@batterypool.com": u.UserRule(dailyRequests=10)},
    )
    store = AtomicStore(policy)
    assert reserve(store) == 4096
    reserve(store)
    with pytest.raises(u.UsageLimitExceeded, match="Workspace"):
        reserve(store)


@pytest.mark.parametrize(
    "policy",
    [
        u.UsagePolicy(defaultUser=u.Rule(dailyRequests=0)),
        u.UsagePolicy(models={MODEL: u.ModelRule(enabled=False)}),
        u.UsagePolicy(users={"person@batterypool.com": u.UserRule(allowedModels=[])}),
    ],
)
def test_zero_and_model_access_blocks_start_no_generation_or_counter_write(policy):
    store = AtomicStore(policy.model_copy(update={"revision": 1}))
    with pytest.raises((u.UsageLimitExceeded, PermissionError)):
        reserve(store)
    assert not store.transactions


def test_period_keys_roll_over_at_india_midnight_without_waiting_for_ttl_deletion():
    store = AtomicStore(
        u.UsagePolicy(revision=1, workspace=u.Rule(dailyRequests=1, monthlyRequests=1))
    )
    reserve(store, now=datetime(2026, 11, 30, 18, 29, 59, tzinfo=timezone.utc))
    reserve(store, now=datetime(2026, 11, 30, 18, 30, tzinfo=timezone.utc))
    assert store.items[("WORKSPACE", "DAY#2026-12-01")]["RequestCount"] == 1
    assert store.items[("WORKSPACE", "MONTH#2026-12")]["RequestCount"] == 1


def test_smallest_output_ceiling_wins():
    store = AtomicStore(
        u.UsagePolicy(
            revision=1,
            workspace=u.Rule(maxOutputTokens=8192),
            defaultUser=u.Rule(maxOutputTokens=4096),
            models={MODEL: u.ModelRule(maxOutputTokens=2048)},
        )
    )
    assert reserve(store) == 2048


def test_metadata_listing_does_not_enable_a_frontier_candidate(monkeypatch):
    monkeypatch.setenv("USAGE_CONTROL_TABLE_NAME", "synthetic")
    monkeypatch.setattr(u, "verified_models", lambda *args: {})
    assert u.effective_models([MODEL, "gpt-6.2-astra"]) == [MODEL]
    store = AtomicStore()
    with pytest.raises(PermissionError, match="runtime access check"):
        reserve(store, model="gpt-6.2-astra")
    assert not store.transactions


def test_only_successful_registered_candidates_are_exposed(monkeypatch):
    monkeypatch.setenv("USAGE_CONTROL_TABLE_NAME", "synthetic")
    monkeypatch.setenv("ENABLE_BEDROCK_GLOBAL_INFERENCE", "true")
    monkeypatch.setenv("BEDROCK_REGION", "us-east-1")
    monkeypatch.setattr(
        u,
        "verified_models",
        lambda: {
            "gpt-6.2-astra": {
                "ready": True,
                "region": "us-east-1",
                "profileId": "global.openai.gpt-6.2-astra",
            },
            "gpt-6.2-sol": {"ready": False},
            "unintegrated": {"ready": True},
        },
    )
    assert u.effective_models([MODEL]) == [MODEL, "gpt-6.2-astra"]


@pytest.mark.parametrize("value", [-1, 1.2, True, "10"])
def test_request_caps_are_strict_nonnegative_integers(value):
    with pytest.raises(ValidationError):
        u.Rule(dailyRequests=value)


def test_policy_conflicts_are_reported_without_losing_the_unsaved_draft(monkeypatch):
    from unittest.mock import Mock
    from app.repositories.common import ResourceConflictError

    client = Mock()
    client.put_item.side_effect = ClientError(
        {"Error": {"Code": "ConditionalCheckFailedException"}}, "PutItem"
    )
    monkeypatch.setattr(u, "storage", lambda: (client, "synthetic"))
    with pytest.raises(ResourceConflictError, match="Reload"):
        u.save_policy(u.UsagePolicy(revision=5), "admin-subject")
    assert (
        client.put_item.call_args.kwargs["ConditionExpression"]
        == "Revision = :revision"
    )


def test_role_or_store_failure_fails_closed(monkeypatch):
    from unittest.mock import Mock

    client = Mock(wraps=AtomicStore())
    client.transact_write_items.side_effect = ClientError(
        {"Error": {"Code": "AccessDeniedException"}}, "TransactWriteItems"
    )
    with pytest.raises(u.UsageControlUnavailable, match="no model request"):
        reserve(client)


def test_write_endpoints_are_admin_only_and_personal_usage_requires_authentication():
    from app.routes.usage_control import router
    from app.dependencies import check_admin, get_current_user

    for route in router.routes:
        required = get_current_user if route.path == "/usage/me" else check_admin
        assert any(
            dependency.call is required for dependency in route.dependant.dependencies
        )


def test_registered_model_cannot_silently_expand_the_enabled_geography(monkeypatch):
    monkeypatch.setenv("BEDROCK_REGION", "us-east-1")
    monkeypatch.setenv("ENABLE_BEDROCK_GLOBAL_INFERENCE", "false")
    monkeypatch.setenv("ENABLE_BEDROCK_CROSS_REGION_INFERENCE", "true")
    monkeypatch.setattr(
        u,
        "verified_models",
        lambda *args: {
            "gpt-6.2-astra": {
                "ready": True,
                "region": "us-east-1",
                "profileId": "global.openai.gpt-6.2-astra",
            }
        },
    )
    store = AtomicStore()
    with pytest.raises(PermissionError, match="runtime access check"):
        reserve(store, model="gpt-6.2-astra")
    assert store.transactions == []


def test_policy_changed_during_reservation_is_reloaded_before_any_model_call():
    store = AtomicStore(u.UsagePolicy(revision=1))
    original = store.transact_write_items
    changed = False

    def race(**kwargs):
        nonlocal changed
        if not changed:
            changed = True
            policy = u.UsagePolicy(revision=2, defaultUser=u.Rule(dailyRequests=0))
            store.items[("CONFIG", "POLICY")] = {
                **u.POLICY_KEY,
                "Revision": 2,
                "Policy": policy.model_dump_json(),
            }
        return original(**kwargs)

    store.transact_write_items = race
    with pytest.raises(u.UsageLimitExceeded):
        reserve(store)
    assert ("WORKSPACE", "DAY#2026-11-24") not in store.items
