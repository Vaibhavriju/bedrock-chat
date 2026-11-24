from threading import Event
from unittest.mock import Mock
import pytest
from botocore.exceptions import ClientError
from app.generation_control import GenerationMonitor, begin_generation, request_stop


class MemoryTable:
    def __init__(self, owner="user-a"):
        self.item = {"UserId": owner}
        self.calls = []

    def get_item(self, **kwargs):
        return {"Item": dict(self.item)} if self.item else {}

    def update_item(self, **kwargs):
        self.calls.append(kwargs)
        values = kwargs["ExpressionAttributeValues"]
        condition = kwargs["ConditionExpression"]
        if (
            self.item.get("UserId") != values[":user"]
            or ("attribute_not_exists(Started)" in condition and "Started" in self.item)
            or (
                "attribute_not_exists(Finished)" in condition
                and "Finished" in self.item
            )
        ):
            raise ClientError(
                {"Error": {"Code": "ConditionalCheckFailedException"}}, "UpdateItem"
            )
        for field in ("Started", "Cancelled", "Finished"):
            if field in kwargs["UpdateExpression"]:
                self.item[field] = True


def test_stop_is_authenticated_and_cannot_cancel_another_owner():
    table = MemoryTable()
    with pytest.raises(ClientError):
        request_stop(table, "connection", "user-b")
    assert "Cancelled" not in table.item
    request_stop(table, "connection", "user-a")
    assert table.item["Cancelled"] is True
    assert table.calls[-1]["Key"] == {"ConnectionId": "connection", "MessagePartId": 0}


def test_duplicate_end_does_not_launch_another_generation():
    table = MemoryTable()
    begin_generation(table, "connection", "user-a")
    with pytest.raises(ClientError):
        begin_generation(table, "connection", "user-a")


def test_monitor_observes_stop_and_finalizes_its_record():
    table = MemoryTable()
    monitor = GenerationMonitor(table, "connection", "user-a", interval=0.001)
    with monitor as signal:
        request_stop(table, "connection", "user-a")
        assert signal.wait(0.5)
    assert table.item["Finished"] is True
    assert not monitor.thread.is_alive()


@pytest.mark.parametrize(
    "item", [{}, {"UserId": "user-b"}, {"UserId": "user-a", "Cancelled": True}]
)
def test_missing_or_wrong_owner_sessions_cancel_safely(item):
    table = MemoryTable()
    table.item = item
    monitor = GenerationMonitor(table, "connection", "user-a")
    monitor.check()
    assert monitor.cancel_signal.is_set()


def test_a_disconnect_signal_is_shared_with_the_running_model():
    signal = Event()
    monitor = GenerationMonitor(
        MemoryTable(), "connection", "user-a", cancel_signal=signal
    )
    signal.set()
    assert monitor.cancel_signal.is_set()


def test_cleanup_failure_does_not_turn_a_saved_answer_into_an_error():
    table = Mock()
    table.get_item.return_value = {"Item": {"UserId": "user-a"}}
    table.update_item.side_effect = RuntimeError("storage temporarily unavailable")
    with GenerationMonitor(table, "connection", "user-a"):
        pass
