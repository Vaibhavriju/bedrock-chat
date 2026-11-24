from threading import Event
from unittest.mock import Mock
from app.repositories.models.conversation import (
    ConversationModel,
    MessageModel,
    ReasoningContentModel,
    TextContentModel,
)
from app.routes.schemas.conversation import ChatInput, MessageInput, TextContent
from app.stream import OnStopInput
from app.usecases.chat import chat, post_process_result


def fixture_data():
    model = "claude-v4.6-sonnet"
    prompt = MessageModel(
        role="user",
        content=[TextContentModel(content_type="text", body="My prompt")],
        model=model,
        parent="system",
        children=[],
        create_time=0,
    )
    root = MessageModel(
        role="system",
        content=[],
        model=model,
        parent=None,
        children=["prompt"],
        create_time=0,
    )
    conversation = ConversationModel(
        id="synthetic-conversation",
        create_time=0,
        title="Synthetic",
        total_price=0,
        message_map={"system": root, "prompt": prompt},
        last_message_id="prompt",
        bot_id=None,
        should_continue=False,
    )
    request = ChatInput(
        conversation_id=conversation.id,
        message=MessageInput(
            role="user",
            model=model,
            content=[TextContent(content_type="text", body="My prompt")],
            parent_message_id="system",
        ),
    )
    return conversation, request


def test_stopped_partial_answer_is_saved_before_the_end_event(monkeypatch):
    conversation, request = fixture_data()
    partial = MessageModel(
        role="assistant",
        content=[
            ReasoningContentModel(
                content_type="reasoning",
                text="incomplete reasoning",
                signature="incomplete signature",
                redacted_content=b"",
            ),
            TextContentModel(content_type="text", body="Visible partial answer"),
        ],
        model=request.message.model,
        parent=None,
        children=[],
        create_time=1,
    )
    result = OnStopInput(
        message=partial,
        stop_reason="cancelled",
        input_token_count=0,
        output_token_count=0,
        cache_read_input_count=0,
        cache_write_input_count=0,
        price=0,
    )
    calls = []
    monkeypatch.setattr(
        "app.usecases.chat.store_conversation", lambda *args: calls.append("saved")
    )
    post_process_result(
        result,
        None,
        conversation,
        "prompt",
        None,
        Mock(id="user-a"),
        request,
        [],
        [],
        on_stop=lambda _: calls.append("end"),
    )
    assert calls == ["saved", "end"]
    saved = conversation.message_map[conversation.last_message_id]
    assert saved.stopped is True
    assert [content.body for content in saved.content] == ["Visible partial answer"]
    assert saved.thinking_log is None
    assert conversation.should_continue is False


def test_stopping_before_invocation_preserves_the_prompt_without_calling_the_model(
    monkeypatch,
):
    conversation, request = fixture_data()
    monkeypatch.setattr(
        "app.usecases.chat.prepare_conversation",
        lambda *_: ("prompt", conversation, None),
    )
    invoke = Mock()
    monkeypatch.setattr(
        "app.strands_integration.chat_strands.converse_with_strands", invoke
    )
    monkeypatch.setattr("app.usecases.chat.store_conversation", lambda *_: None)
    signal = Event()
    signal.set()
    saved, answer = chat(Mock(id="user-a"), request, cancel_signal=signal)
    invoke.assert_not_called()
    assert saved.message_map["prompt"].content[0].body == "My prompt"
    assert answer.stopped is True
    assert "stopped" in answer.content[0].body.lower()


def test_real_strands_cancellation_keeps_the_text_already_shown_to_the_user(
    monkeypatch,
):
    import asyncio
    from strands import Agent
    from strands.models.model import Model
    from app.strands_integration.chat_strands import converse_with_strands
    from app.repositories.models.conversation import SimpleMessageModel

    signal = Event()

    class SyntheticModel(Model):
        def update_config(self, **kwargs):
            pass

        def get_config(self):
            return {"model_id": "synthetic-no-network"}

        async def structured_output(self, *args, **kwargs):
            raise NotImplementedError
            yield {}

        async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
            yield {"messageStart": {"role": "assistant"}}
            yield {"contentBlockStart": {"contentBlockIndex": 0, "start": {}}}
            yield {
                "contentBlockDelta": {
                    "contentBlockIndex": 0,
                    "delta": {"text": "Visible partial answer"},
                }
            }
            signal.set()
            await asyncio.sleep(0.05)
            yield {
                "contentBlockDelta": {
                    "contentBlockIndex": 0,
                    "delta": {"text": "THIS MUST NOT APPEAR"},
                }
            }
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"messageStop": {"stopReason": "end_turn"}}

    agent = Agent(model=SyntheticModel(), callback_handler=None)
    monkeypatch.setattr(
        "app.strands_integration.chat_strands.create_strands_agent", lambda **_: agent
    )
    _, request = fixture_data()
    emitted = []
    result = converse_with_strands(
        None,
        request,
        [],
        None,
        None,
        False,
        [
            SimpleMessageModel(
                role="user",
                content=[TextContentModel(content_type="text", body="Test")],
            )
        ],
        [],
        on_stream=emitted.append,
        cancel_signal=signal,
    )
    assert result["stop_reason"] == "cancelled"
    assert "".join(emitted) == "Visible partial answer"
    assert result["message"].content[0].body == "Visible partial answer"


def test_legacy_stream_is_closed_and_incomplete_tool_json_is_not_replayed(monkeypatch):
    from app.stream import ConverseApiStreamHandler

    signal = Event()

    class SyntheticStream:
        closed = False

        def __iter__(self):
            yield {"messageStart": {"role": "assistant"}}
            yield {
                "contentBlockDelta": {
                    "contentBlockIndex": 0,
                    "delta": {"text": "Visible partial answer"},
                }
            }
            yield {
                "contentBlockStart": {
                    "contentBlockIndex": 1,
                    "start": {"toolUse": {"toolUseId": "tool", "name": "synthetic"}},
                }
            }
            yield {
                "contentBlockDelta": {
                    "contentBlockIndex": 1,
                    "delta": {"toolUse": {"input": '{"incomplete":'}},
                }
            }
            signal.set()
            yield {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 1}}}

        def close(self):
            self.closed = True

    stream = SyntheticStream()
    client = Mock()
    client.converse_stream.return_value = {"stream": stream}
    monkeypatch.setattr("app.stream.get_bedrock_runtime_client", lambda: client)
    monkeypatch.setattr("app.stream.compose_args_for_converse_api", lambda **_: {})
    monkeypatch.setattr("app.stream.calculate_price", lambda **_: 0)
    result = ConverseApiStreamHandler(
        model="claude-v4.6-sonnet", cancel_signal=signal
    ).run([])
    assert result["stop_reason"] == "cancelled"
    assert result["message"].content[0].body == "Visible partial answer"
    assert len(result["message"].content) == 1
    assert stream.closed is True


def test_saved_cancelled_answer_sends_the_authoritative_completion_event():
    import json
    from app.websocket import NotificationSender

    sender = NotificationSender("https://example.invalid", "synthetic-connection")
    sender.on_stop(
        {
            "message": None,
            "stop_reason": "cancelled",
            "input_token_count": 0,
            "output_token_count": 0,
            "cache_read_input_count": 0,
            "cache_write_input_count": 0,
            "price": 0,
        }
    )
    queued = sender.commands.get_nowait()
    payload = json.loads(queued["payload"])
    assert payload["status"] == "STREAMING_END"
    assert payload["stop_reason"] == "cancelled"
