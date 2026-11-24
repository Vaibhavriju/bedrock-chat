from app.dependencies import check_admin, get_current_user
from app.routes.schemas.conversation import type_model_name
from app.usage_control import (
    UsagePolicy,
    read_policy,
    save_policy,
    storage,
    read_item,
    usage_snapshot,
)
from fastapi import APIRouter, Depends, Request, Response

router = APIRouter(tags=["admin"])


@router.get("/admin/limits", dependencies=[Depends(check_admin)])
def get_limits(response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    client, _ = storage()
    return {
        "policy": read_policy().model_dump(),
        "configured": client is not None,
        "timezone": "Asia/Kolkata",
        "notice": "Generation-attempt quotas, not AWS dollar or token budgets. Blank means no additional cap; employee blanks inherit the default.",
    }


@router.put("/admin/limits", dependencies=[Depends(check_admin)])
def put_limits(request: Request, policy: UsagePolicy):
    return save_policy(policy, request.state.current_user.id).model_dump()


@router.get("/admin/limits/usage", dependencies=[Depends(check_admin)])
def get_usage(model: type_model_name, email: str, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    client, name = storage()
    item = (
        read_item(
            client, name, {"PK": "EMAIL#" + email.strip().lower(), "SK": "SUBJECT"}
        )
        if client
        else {}
    )
    return usage_snapshot(
        item.get("Subject"), email, model, client=client, table_name=name
    )


@router.get("/usage/me", dependencies=[Depends(get_current_user)])
def my_usage(request: Request, model: type_model_name, response: Response):
    response.headers["Cache-Control"] = "private, no-store"
    user = request.state.current_user
    return usage_snapshot(user.id, user.email, model)
