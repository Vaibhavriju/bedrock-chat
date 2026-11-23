from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError

from app import model_catalog


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(
        model_catalog, "get_global_available_models", lambda: ["claude-v4.6-sonnet"]
    )
    client = Mock()
    client.list_foundation_models.return_value = {
        "modelSummaries": [
            {
                "modelId": "anthropic.claude-sonnet-4-6",
                "modelName": "Sonnet 4.6",
                "providerName": "Anthropic",
                "outputModalities": ["TEXT"],
                "responseStreamingSupported": True,
            },
            {
                "modelId": "anthropic.claude-sonnet-5-5",
                "modelName": "Sonnet 5.5",
                "providerName": "Anthropic",
                "outputModalities": ["TEXT"],
            },
        ]
    }
    client.list_inference_profiles.return_value = {
        "inferenceProfileSummaries": [
            {
                "status": "ACTIVE",
                "inferenceProfileId": "us.anthropic.claude-sonnet-5-5",
                "models": [
                    {
                        "modelArn": "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-5-5"
                    }
                ],
            }
        ]
    }
    client.get_foundation_model_availability.return_value = {
        "authorizationStatus": "AUTHORIZED",
        "entitlementAvailability": "AVAILABLE",
        "regionAvailability": "AVAILABLE",
        "agreementAvailability": {"status": "AVAILABLE"},
    }
    return client


def test_metadata_is_not_an_inference_confirmation(client):
    catalog = model_catalog.build_catalog(client, "us-east-1")
    old, new = catalog["models"]
    assert old["configured"] is True
    assert new["configured"] is False
    assert new["candidate"] is True
    assert new["access"] == "metadata_available"
    assert new["profileIds"] == ["us.anthropic.claude-sonnet-5-5"]
    client.converse.assert_not_called()
    client.create_foundation_model_agreement.assert_not_called()


@pytest.mark.parametrize(
    "field,value",
    [
        ("authorizationStatus", "NOT_AUTHORIZED"),
        ("entitlementAvailability", "NOT_AVAILABLE"),
        ("regionAvailability", "NOT_AVAILABLE"),
        ("agreementAvailability", {"status": "NOT_AVAILABLE"}),
    ],
)
def test_active_profile_does_not_override_access_restrictions(client, field, value):
    client.get_foundation_model_availability.return_value[field] = value
    row = model_catalog.build_catalog(client, "us-east-1")["models"][1]
    assert row["access"] == (
        "agreement_required" if field == "agreementAvailability" else "restricted"
    )
    assert row["configured"] is False


def test_pending_agreement_is_separate(client):
    client.get_foundation_model_availability.return_value["agreementAvailability"] = {
        "status": "PENDING"
    }
    assert (
        model_catalog.build_catalog(client, "us-east-1")["models"][1]["access"]
        == "pending"
    )


def test_profile_pagination(client):
    client.list_inference_profiles.side_effect = [
        {"inferenceProfileSummaries": [], "nextToken": "next"},
        {"inferenceProfileSummaries": []},
    ]
    model_catalog.build_catalog(client, "us-east-1")
    assert client.list_inference_profiles.call_count == 2
    client.list_inference_profiles.assert_called_with(nextToken="next")


def test_profile_error_is_visible_without_fabricated_access(client):
    client.list_inference_profiles.side_effect = ClientError(
        {"Error": {"Code": "AccessDeniedException", "Message": "denied"}},
        "ListInferenceProfiles",
    )
    catalog = model_catalog.build_catalog(client, "us-east-1")
    assert catalog["warnings"]
    assert catalog["models"][1]["profileIds"] == []


def test_admin_route_is_protected():
    from app.routes.model_catalog import router
    from app.dependencies import check_admin

    assert any(
        dep.call is check_admin for dep in router.routes[0].dependant.dependencies
    )


def test_missing_access_metadata_is_not_authorized(client):
    client.get_foundation_model_availability.return_value = {}
    assert (
        model_catalog.build_catalog(client, "us-east-1")["models"][1]["access"]
        == "unknown"
    )


def test_workspace_model_policy_rejects_disabled_model_before_loading_data(monkeypatch):
    from app.usecases.chat import prepare_conversation
    from app.usecases import global_config
    from app.routes.schemas.conversation import ChatInput
    from app.user import User

    monkeypatch.setattr(
        global_config, "get_global_available_models", lambda: ["claude-v4.6-sonnet"]
    )
    chat = ChatInput.model_validate(
        {
            "conversationId": "test",
            "message": {
                "model": "amazon-nova-2-lite",
                "parentMessageId": "system",
                "role": "user",
                "content": [{"contentType": "text", "body": "hello"}],
            },
        }
    )
    user = User(id="test", name="test", email="test@example.com", groups=[])
    with pytest.raises(PermissionError, match="not enabled"):
        prepare_conversation(user, chat)
