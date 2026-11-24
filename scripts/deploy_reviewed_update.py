#!/usr/bin/env python3
"""Deploy or inspect the reviewed BatteryPool update using existing CodeBuild settings.

Uses the current AWS session. Creates no users, keys, subscriptions or new roles.
The application commit is pinned; repeated runs inspect the existing matching build.
"""
import copy
import json
import sys

import boto3

REGION = "us-east-1"
PROJECT = "Project-qxDibdGZgEGd"
ACCOUNT = "940880953077"
REPOSITORY = "https://github.com/Vaibhavriju/bedrock-chat.git"
REVIEWED_COMMIT = "aa10fb33975c56023508a1d6482316fcaa32fd14"
BRANCH = "improve-chat-experience"


def deploy_or_check(client):
    ids = client.list_builds_for_project(
        projectName=PROJECT, sortOrder="DESCENDING"
    ).get("ids", [])[:20]
    builds = client.batch_get_builds(ids=ids).get("builds", []) if ids else []
    marker = f"git checkout --detach {REVIEWED_COMMIT}"
    matches = [
        build for build in builds
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

    projects = client.batch_get_projects(names=[PROJECT]).get("projects", [])
    if not projects:
        raise ValueError("Deployment project was not found in the current AWS session.")
    project = projects[0]
    if project.get("arn") != f"arn:aws:codebuild:{REGION}:{ACCOUNT}:project/{PROJECT}":
        raise ValueError("The AWS account or deployment project does not match BatteryPool.")
    if project.get("source", {}).get("type") != "NO_SOURCE":
        raise ValueError("The deployment source changed; review its configuration before retrying.")
    variables = project["environment"]["environmentVariables"]
    env = {value["name"]: value for value in variables}
    if env.get("REPO_URL", {}).get("value") != REPOSITORY:
        raise ValueError("The configured repository does not match the reviewed repository.")
    variable = env.get("CDK_JSON_OVERRIDE", {})
    if variable.get("type") != "PLAINTEXT":
        raise ValueError("CDK override storage changed; review it before deploying.")
    override = json.loads(variable["value"])
    models = override.get("context", {}).get("globalAvailableModels")
    if not isinstance(models, list) or not models or not all(isinstance(m, str) for m in models):
        raise ValueError("Expected an explicit workspace model list; no settings were changed.")
    if "amazon-nova-2-lite" not in models:
        models.append("amazon-nova-2-lite")

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
        buildspecOverride=json.dumps(spec),
        environmentVariablesOverride=[
            {"name": "VERSION", "value": BRANCH, "type": "PLAINTEXT"},
            {"name": "CDK_JSON_OVERRIDE", "value": json.dumps(override), "type": "PLAINTEXT"},
        ],
    )["build"]
    return build, True


def main():
    try:
        client = boto3.client("codebuild", region_name=REGION)
        build, started = deploy_or_check(client)
        print(json.dumps({
            "StartedNewBuild": started,
            "BuildID": build["id"],
            "ReviewedCommit": REVIEWED_COMMIT,
            "Status": build["buildStatus"],
            "Phase": build.get("currentPhase"),
            "Logs": build.get("logs", {}).get("deepLink"),
            "Errors": [
                context for phase in build.get("phases", [])
                if phase.get("phaseStatus") in ("FAILED", "FAULT", "TIMED_OUT")
                for context in phase.get("contexts", [])
            ],
        }, indent=2))
        print("Run the same command again to check progress; it will reuse this build.")
    except Exception as exc:
        print(f"Deployment could not be started or checked: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
