"""Authenticated cancellation using the existing WebSocket session record."""

import logging
from threading import Event, Thread
from time import time, monotonic
from typing import Callable

logger = logging.getLogger(__name__)


def session_key(connection_id: str) -> dict:
    return {"ConnectionId": connection_id, "MessagePartId": 0}


def begin_generation(table, connection_id: str, user_id: str):
    # One generation per socket. A duplicate END must not launch another model call.
    table.update_item(
        Key=session_key(connection_id),
        UpdateExpression="SET Started = :yes, expire = :expire",
        ConditionExpression="UserId = :user AND attribute_not_exists(Started)",
        ExpressionAttributeValues={
            ":user": user_id,
            ":yes": True,
            ":expire": int(time()) + 1200,
        },
    )


def request_stop(table, connection_id: str, user_id: str):
    table.update_item(
        Key=session_key(connection_id),
        UpdateExpression="SET Cancelled = :yes",
        ConditionExpression="UserId = :user AND attribute_not_exists(Finished)",
        ExpressionAttributeValues={":user": user_id, ":yes": True},
    )


class GenerationMonitor:
    """Mirror cancellation to the SDK's caller-owned, thread-safe Event."""

    def __init__(
        self,
        table,
        connection_id: str,
        user_id: str,
        interval: float = 1.0,
        cancel_signal: Event | None = None,
        on_heartbeat: Callable[[], None] | None = None,
        heartbeat_interval: float = 15.0,
    ):
        self.table = table
        self.connection_id = connection_id
        self.user_id = user_id
        self.interval = interval
        self.on_heartbeat = on_heartbeat
        self.heartbeat_interval = heartbeat_interval
        self.cancel_signal = cancel_signal if cancel_signal is not None else Event()
        self.done = Event()
        self.thread = Thread(target=self._run, daemon=True)

    def check(self):
        item = self.table.get_item(
            Key=session_key(self.connection_id), ConsistentRead=True
        ).get("Item")
        if not item or item.get("UserId") != self.user_id or item.get("Cancelled"):
            self.cancel_signal.set()

    def _run(self):
        warned = False
        next_heartbeat = monotonic() + self.heartbeat_interval
        while not self.done.is_set() and not self.cancel_signal.is_set():
            try:
                self.check()
                if (
                    self.on_heartbeat
                    and not self.cancel_signal.is_set()
                    and monotonic() >= next_heartbeat
                ):
                    self.on_heartbeat()
                    next_heartbeat = monotonic() + self.heartbeat_interval
            except Exception:
                if not warned:
                    logger.warning(
                        "Cancellation status check failed; retrying.", exc_info=True
                    )
                    warned = True
            self.done.wait(self.interval)

    def __enter__(self):
        self.check()
        self.thread.start()
        return self.cancel_signal

    def __exit__(self, *_):
        self.done.set()
        self.thread.join(timeout=5)
        try:
            self.table.update_item(
                Key=session_key(self.connection_id),
                UpdateExpression="SET Finished = :yes",
                ConditionExpression="UserId = :user",
                ExpressionAttributeValues={":user": self.user_id, ":yes": True},
            )
        except Exception:
            logger.warning("Could not finalize the cancellation record.", exc_info=True)
