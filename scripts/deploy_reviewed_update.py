#!/usr/bin/env python3
"""Deploy or inspect the reviewed BatteryPool update using existing CodeBuild settings.

Uses the current AWS session. Creates no users, keys, subscriptions or new roles.
The application commit is pinned; repeated runs inspect the existing matching build.
"""

import argparse
import copy
import json
import sys

import boto3
from botocore.config import Config

REGION = "us-east-1"
PROJECT = "Project-qxDibdGZgEGd"
ACCOUNT = "940880953077"
REPOSITORY = "https://github.com/Vaibhavriju/bedrock-chat.git"
REVIEWED_COMMIT = "cb626c2d44fded122db4370190028783a69264c1"
BRANCH = "improve-chat-experience"


def deploy_or_check(client):
    projects = client.batch_get_projects(names=[PROJECT]).get("projects", [])
    if not projects:
        raise ValueError("Deployment project was not found in the current AWS session.")
    project = projects[0]
    if project.get("arn") != f"arn:aws:codebuild:{REGION}:{ACCOUNT}:project/{PROJECT}":
        raise ValueError(
            "The AWS account or deployment project does not match BatteryPool."
        )
    if project.get("source", {}).get("type") != "NO_SOURCE":
        raise ValueError(
            "The deployment source changed; review its configuration before retrying."
        )
    variables = project["environment"]["environmentVariables"]
    env = {value["name"]: value for value in variables}
    if env.get("REPO_URL", {}).get("value") != REPOSITORY:
        raise ValueError(
            "The configured repository does not match the reviewed repository."
        )
    variable = env.get("CDK_JSON_OVERRIDE", {})
    if variable.get("type") != "PLAINTEXT":
        raise ValueError("CDK override storage changed; review it before deploying.")
    override = json.loads(variable["value"])
    models = override.get("context", {}).get("globalAvailableModels")
    if (
        not isinstance(models, list)
        or not models
        or not all(isinstance(m, str) for m in models)
    ):
        raise ValueError(
            "Expected an explicit workspace model list; no settings were changed."
        )
    if "amazon-nova-2-lite" not in models:
        models.append("amazon-nova-2-lite")

    ids = client.list_builds_for_project(
        projectName=PROJECT, sortOrder="DESCENDING"
    ).get("ids", [])[:20]
    builds = client.batch_get_builds(ids=ids).get("builds", []) if ids else []
    marker = f"git checkout --detach {REVIEWED_COMMIT}"
    matches = [
        build
        for build in builds
        if marker in (build.get("source", {}).get("buildspec") or "")
    ]
    if matches:
        return max(matches, key=lambda build: build["startTime"]), False

    active = [build for build in builds if build.get("buildStatus") == "IN_PROGRESS"]
    if active:
        latest = max(active, key=lambda build: build["startTime"])
        raise ValueError(
            f"Deployment {latest['id']} is still running. Wait for it to finish and rerun; "
            "no concurrent deployment was started."
        )

    spec = copy.deepcopy(json.loads(project["source"]["buildspec"]))
    commands = spec["phases"]["build"]["commands"]
    position = commands.index("cd bedrock-chat") + 1
    commands[position:position] = [
        marker,
        f'test "$(git rev-parse HEAD)" = "{REVIEWED_COMMIT}"',
        "git log -1 --oneline",
    ]
    build = client.start_build(
        projectName=PROJECT,
        idempotencyToken=REVIEWED_COMMIT,
        buildspecOverride=json.dumps(spec),
        environmentVariablesOverride=[
            {"name": "VERSION", "value": BRANCH, "type": "PLAINTEXT"},
            {
                "name": "CDK_JSON_OVERRIDE",
                "value": json.dumps(override),
                "type": "PLAINTEXT",
            },
        ],
    )["build"]
    return build, True


def check_frontier_models(stack_name="BedrockChatStack", force=False):
    cf = boto3.client("cloudformation", region_name=REGION)
    outputs = cf.describe_stacks(StackName=stack_name)["Stacks"][0].get("Outputs", [])
    functions = [
        entry["OutputValue"]
        for entry in outputs
        if entry["OutputKey"] == "FrontierModelProbeFunctionName"
    ]
    if len(functions) != 1:
        raise ValueError(
            "The deployment did not expose its reviewed frontier probe. Check the application stack name."
        )
    function = functions[0]
    print(
        "Build succeeded. Checking streaming/reasoning and a follow-up using the production chat role; only passing models will be enabled.",
        flush=True,
    )
    client = boto3.client(
        "lambda",
        region_name=REGION,
        config=Config(connect_timeout=5, read_timeout=660, retries={"max_attempts": 0}),
    )
    result = client.invoke(
        FunctionName=function,
        InvocationType="RequestResponse",
        Payload=json.dumps({"enableSuccessful": True, "force": force}).encode(),
    )
    payload = json.loads(result["Payload"].read())
    if result.get("FunctionError"):
        raise ValueError(
            "Application-role model check failed: "
            + str(payload.get("errorMessage", "See the probe's CloudWatch logs."))[:900]
        )
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stack-name", default="BedrockChatStack")
    parser.add_argument(
        "--recheck-models",
        action="store_true",
        help="Rerun bounded model tests after a new AWS access change.",
    )
    args = parser.parse_args()
    try:
        client = boto3.client("codebuild", region_name=REGION)
        build, started = deploy_or_check(client)
        output = {
            "StartedNewBuild": started,
            "BuildID": build["id"],
            "ReviewedCommit": REVIEWED_COMMIT,
            "Status": build["buildStatus"],
            "Phase": build.get("currentPhase"),
            "Logs": build.get("logs", {}).get("deepLink"),
            "Errors": [
                context
                for phase in build.get("phases", [])
                if phase.get("phaseStatus") in ("FAILED", "FAULT", "TIMED_OUT")
                for context in phase.get("contexts", [])
            ],
        }
        if build["buildStatus"] == "SUCCEEDED":
            try:
                output["FrontierModels"] = check_frontier_models(
                    args.stack_name, force=args.recheck_models
                )
            except Exception as model_error:
                output["FrontierModels"] = {
                    "status": "ERROR",
                    "error": str(model_error)[:1000],
                }
                print(json.dumps(output, indent=2))
                print(
                    "The build succeeded, but model registration is incomplete. Resolve the error and rerun this command.",
                    file=sys.stderr,
                )
                return 1
        print(json.dumps(output, indent=2))
        print(
            "Run the same command again to check progress; it will reuse this build. Model checks reuse completed results unless --recheck-models is supplied."
        )
    except Exception as exc:
        print(f"Deployment could not be started or checked: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
