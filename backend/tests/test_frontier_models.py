from unittest.mock import Mock

import pytest

from app.bedrock import (
    get_model_id,
    generation_params_to_converse_configuration,
    is_prefill_supported,
    is_temperature_supported,
    is_top_p_supported,
    is_prompt_caching_supported,
)
from app.frontier_models import FRONTIER_MODELS, CLAUDE_55
from app.repositories.models.custom_bot import GenerationParamsModel
from app.routes.schemas.conversation import ChatInput
from app.strands_integration.agent.config import get_bedrock_model_config


@pytest.mark.parametrize("model", FRONTIER_MODELS)
@pytest.mark.parametrize("reasoning", [False, True])
def test_frontier_parameters_and_schemas(model, reasoning):
    request = ChatInput.model_validate(
        {
            "conversationId": "synthetic",
            "message": {
                "model": model,
                "role": "user",
                "parentMessageId": "system",
                "content": [{"contentType": "text", "body": "Hi"}],
            },
        }
    )
    assert request.message.model == model
    config = generation_params_to_converse_configuration(
        model, enable_reasoning=reasoning
    )
    assert config["inferenceConfig"] == {"maxTokens": 32768}
    assert not is_temperature_supported(model)
    assert not is_top_p_supported(model)
    assert not is_prefill_supported(model)
    fields = config.get("additionalModelRequestFields", {})
    if model == "claude-v5.5-opus":
        assert fields["thinking"]["type"] == "adaptive"
    elif model == "claude-v5.5-sonnet" and not reasoning:
        assert fields["thinking"] == {"type": "between_tools"}
    elif model == "claude-v5.5-haiku" and not reasoning:
        assert fields["thinking"] == {"type": "disabled"}
    elif model in CLAUDE_55:
        assert fields["thinking"] == {"type": "adaptive", "display": "summarized"}
    elif reasoning:
        assert fields == {"reasoning": {"summary": "auto"}}
    else:
        assert fields == {}


@pytest.mark.parametrize("model,model_id", FRONTIER_MODELS.items())
def test_both_profile_types_and_maximum_output_are_explicit(model, model_id):
    assert (
        get_model_id(model, enable_global=True, bedrock_region="us-east-1")
        == "global." + model_id
    )
    assert (
        get_model_id(
            model,
            enable_global=False,
            enable_cross_region=True,
            bedrock_region="us-east-1",
        )
        == "us." + model_id
    )
    config = generation_params_to_converse_configuration(
        model, GenerationParamsModel(max_tokens=200000)
    )
    assert config["inferenceConfig"]["maxTokens"] == 128000
    assert is_prompt_caching_supported(model, "message") == (model in CLAUDE_55)


def test_probe_uses_an_internal_profile_override_without_client_input():
    config = get_bedrock_model_config(
        "gpt-6.2-astra",
        runtime_model_id="us.openai.gpt-6.2-astra",
        enable_reasoning=True,
    )
    assert config["model_id"] == "us.openai.gpt-6.2-astra"
    assert config["additional_request_fields"] == {"reasoning": {"summary": "auto"}}
    assert "temperature" not in config and "top_p" not in config


def test_selected_profile_matches_the_one_that_passed_in_the_application_role(
    monkeypatch,
):
    monkeypatch.setenv("USAGE_CONTROL_TABLE_NAME", "synthetic")
    monkeypatch.setattr(
        "app.usage_control.verified_models",
        lambda: {
            "gpt-6.2-astra": {
                "ready": True,
                "profileId": "us.openai.gpt-6.2-astra",
                "region": "us-east-1",
            }
        },
    )
    assert (
        get_model_id(
            "gpt-6.2-astra",
            enable_global=True,
            enable_cross_region=True,
            bedrock_region="us-east-1",
        )
        == "us.openai.gpt-6.2-astra"
    )


def test_previously_verified_global_profile_is_rejected_if_global_routing_was_disabled(
    monkeypatch,
):
    monkeypatch.setenv("USAGE_CONTROL_TABLE_NAME", "synthetic")
    monkeypatch.setattr(
        "app.usage_control.verified_models",
        lambda: {
            "gpt-6.2-astra": {
                "ready": True,
                "region": "us-east-1",
                "profileId": "global.openai.gpt-6.2-astra",
            }
        },
    )
    with pytest.raises(PermissionError, match="routing"):
        get_model_id(
            "gpt-6.2-astra",
            enable_global=False,
            enable_cross_region=True,
            bedrock_region="us-east-1",
        )


def test_gpt62_estimates_account_for_cache_and_long_context_tiers(monkeypatch):
    from app.bedrock import calculate_price
    monkeypatch.setattr("app.bedrock.get_model_id", lambda _: "global.openai.gpt-6.2-sol")
    assert calculate_price("gpt-6.2-sol", 1000, 1000, 500, 200) == pytest.approx(0.01255)
    assert calculate_price("gpt-6.2-sol", 273000, 1000, 0, 0) == pytest.approx(1.107)
    monkeypatch.setattr("app.bedrock.get_model_id", lambda _: "us.openai.gpt-6.2-astra")
    assert calculate_price("gpt-6.2-astra", 1000, 1000, 0, 0) == pytest.approx(0.0528)
