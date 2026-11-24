from app.bedrock import get_model_id, _prepare_nova_model_params


def test_nova2_profile_selection_respects_geographic_flags():
    assert (
        get_model_id(
            "amazon-nova-2-lite",
            enable_global=True,
            enable_cross_region=True,
            bedrock_region="us-east-1",
        )
        == "global.amazon.nova-2-lite-v1:0"
    )
    assert (
        get_model_id(
            "amazon-nova-2-lite",
            enable_global=False,
            enable_cross_region=True,
            bedrock_region="us-east-1",
        )
        == "us.amazon.nova-2-lite-v1:0"
    )


def test_nova2_does_not_inherit_nova1_output_cap():
    config = _prepare_nova_model_params("amazon-nova-2-lite")
    assert config["inferenceConfig"]["maxTokens"] == 32768
    assert "additionalModelRequestFields" not in config
    assert (
        _prepare_nova_model_params("amazon-nova-lite")["inferenceConfig"]["maxTokens"]
        == 4096
    )
