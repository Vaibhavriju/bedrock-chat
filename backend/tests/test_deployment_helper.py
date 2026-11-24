import copy
import importlib.util
import io
import json
from pathlib import Path
from unittest.mock import Mock

import pytest

path = Path(__file__).resolve().parents[2] / "scripts" / "deploy_reviewed_update.py"
spec = importlib.util.spec_from_file_location("reviewed_deploy", path)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

OVERRIDE = {
    "context": {
        "alternateDomainName": "llm.batterypool.com",
        "hostedZoneId": "existing-zone",
        "defaultModel": "claude-v4.6-sonnet",
        "titleModel": "amazon-nova-lite",
        "globalAvailableModels": ["claude-v4.6-sonnet"],
        "selfSignUpEnabled": False,
    }
}


@pytest.fixture
def client():
    client = Mock()
    client.batch_get_projects.return_value = {
        "projects": [
            {
                "arn": f"arn:aws:codebuild:{helper.REGION}:{helper.ACCOUNT}:project/{helper.PROJECT}",
                "source": {
                    "type": "NO_SOURCE",
                    "buildspec": json.dumps(
                        {
                            "phases": {
                                "build": {
                                    "commands": [
                                        "git clone --branch $VERSION $REPO_URL bedrock-chat",
                                        "cd bedrock-chat",
                                        "cd cdk",
                                        "npx cdk deploy --require-approval never --all",
                                    ]
                                }
                            }
                        }
                    ),
                },
                "environment": {
                    "environmentVariables": [
                        {
                            "name": "REPO_URL",
                            "type": "PLAINTEXT",
                            "value": helper.REPOSITORY,
                        },
                        {
                            "name": "CDK_JSON_OVERRIDE",
                            "type": "PLAINTEXT",
                            "value": json.dumps(OVERRIDE),
                        },
                    ]
                },
            }
        ]
    }
    client.list_builds_for_project.return_value = {"ids": []}
    client.start_build.return_value = {
        "build": {"id": "synthetic", "buildStatus": "IN_PROGRESS"}
    }
    return client


def test_pins_checkout_and_preserves_the_live_domain_auth_defaults_and_models(client):
    result, started = helper.deploy_or_check(client)
    assert started and result["id"] == "synthetic"
    kwargs = client.start_build.call_args.kwargs
    assert kwargs["idempotencyToken"] == helper.REVIEWED_COMMIT
    commands = json.loads(kwargs["buildspecOverride"])["phases"]["build"]["commands"]
    assert commands[2] == f"git checkout --detach {helper.REVIEWED_COMMIT}"
    assert helper.REVIEWED_COMMIT in commands[3]
    env = {
        entry["name"]: entry["value"]
        for entry in kwargs["environmentVariablesOverride"]
    }
    assert env["VERSION"] == helper.BRANCH
    expected = copy.deepcopy(OVERRIDE)
    expected["context"]["globalAvailableModels"].append("amazon-nova-2-lite")
    assert json.loads(env["CDK_JSON_OVERRIDE"]) == expected
    assert "gpt-6.2-astra" not in expected["context"]["globalAvailableModels"]


def test_matching_build_is_reused(client):
    client.list_builds_for_project.return_value = {"ids": ["matching"]}
    client.batch_get_builds.return_value = {
        "builds": [
            {
                "id": "matching",
                "startTime": 1,
                "buildStatus": "SUCCEEDED",
                "source": {
                    "buildspec": f"git checkout --detach {helper.REVIEWED_COMMIT}"
                },
            }
        ]
    }
    assert helper.deploy_or_check(client)[1] is False
    client.start_build.assert_not_called()


def test_concurrent_unrelated_build_is_not_started_over(client):
    client.list_builds_for_project.return_value = {"ids": ["busy"]}
    client.batch_get_builds.return_value = {
        "builds": [
            {
                "id": "busy",
                "startTime": 1,
                "buildStatus": "IN_PROGRESS",
                "source": {"buildspec": "other"},
            }
        ]
    }
    with pytest.raises(ValueError, match="still running"):
        helper.deploy_or_check(client)
    client.start_build.assert_not_called()


@pytest.mark.parametrize("change", ["account", "repository", "source"])
def test_wrong_account_repo_or_source_is_rejected_before_any_matching_build_can_be_reused(
    client, change
):
    project = client.batch_get_projects.return_value["projects"][0]
    if change == "account":
        project["arn"] = "arn:aws:codebuild:us-east-1:000000000000:project/wrong"
    if change == "source":
        project["source"]["type"] = "GITHUB"
    if change == "repository":
        project["environment"]["environmentVariables"][0][
            "value"
        ] = "https://github.com/other/project.git"
    with pytest.raises(ValueError):
        helper.deploy_or_check(client)
    client.start_build.assert_not_called()
    client.list_builds_for_project.assert_not_called()


def test_postdeploy_check_invokes_only_the_exported_private_function(monkeypatch):
    cf, runtime = Mock(), Mock()
    cf.describe_stacks.return_value = {
        "Stacks": [
            {
                "Outputs": [
                    {
                        "OutputKey": "FrontierModelProbeFunctionName",
                        "OutputValue": "reviewed-private-probe",
                    }
                ]
            }
        ]
    }
    runtime.invoke.return_value = {
        "Payload": io.BytesIO(b'{"status":"COMPLETE","enabled":["gpt-6.2-astra"]}')
    }
    monkeypatch.setattr(
        helper.boto3,
        "client",
        lambda name, **kwargs: cf if name == "cloudformation" else runtime,
    )
    assert helper.check_frontier_models()["enabled"] == ["gpt-6.2-astra"]
    params = runtime.invoke.call_args.kwargs
    assert params["FunctionName"] == "reviewed-private-probe"
    assert json.loads(params["Payload"]) == {"enableSuccessful": True, "force": False}


def test_in_progress_deploy_does_not_invoke_models(monkeypatch):
    monkeypatch.setattr(helper.sys, "argv", ["deploy"])
    monkeypatch.setattr(helper.boto3, "client", Mock())
    monkeypatch.setattr(
        helper,
        "deploy_or_check",
        lambda _: ({"id": "synthetic", "buildStatus": "IN_PROGRESS"}, False),
    )
    check = Mock()
    monkeypatch.setattr(helper, "check_frontier_models", check)
    assert helper.main() == 0
    check.assert_not_called()


def test_model_check_failure_preserves_successful_build_status_in_the_report(
    monkeypatch, capsys
):
    monkeypatch.setattr(helper.sys, "argv", ["deploy"])
    monkeypatch.setattr(helper.boto3, "client", Mock())
    monkeypatch.setattr(
        helper,
        "deploy_or_check",
        lambda _: ({"id": "synthetic", "buildStatus": "SUCCEEDED"}, False),
    )
    monkeypatch.setattr(
        helper,
        "check_frontier_models",
        Mock(side_effect=PermissionError("lambda:InvokeFunction is required")),
    )
    assert helper.main() == 1
    output = json.loads(capsys.readouterr().out)
    assert output["Status"] == "SUCCEEDED"
    assert output["FrontierModels"]["status"] == "ERROR"
