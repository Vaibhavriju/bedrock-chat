import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostStreamingStatus } from '../constants';
import { PostMessageRequest } from '../@types/conversation';
import usePostMessageStreaming from './usePostMessageStreaming';

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: async () => ({
    tokens: { idToken: { toString: () => 'synthetic-test-token' } },
  }),
}));

class FakeSocket {
  static latest: FakeSocket;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  send = vi.fn();
  close = vi.fn(() => this.onclose?.());
  constructor() {
    FakeSocket.latest = this;
  }
}
const input = {
  conversationId: 'smoke-test',
  message: {
    content: [{ body: 'hello', contentType: 'text' }],
    model: 'claude-v4.6-sonnet',
    role: 'user',
  },
} as PostMessageRequest;

describe('stream completion and failures', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not report success on a premature close', async () => {
    const promise = usePostMessageStreaming
      .getState()
      .post({ input, handleStreamingEvent: vi.fn() });
    const rejected = expect(promise).rejects.toThrow('connection ended');
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.latest.onclose?.();
    await rejected;
    expect(usePostMessageStreaming.getState().errorDetail).toContain(
      'before the response completed'
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves only after the explicit completion event', async () => {
    const event = vi.fn();
    const promise = usePostMessageStreaming
      .getState()
      .post({ input, handleStreamingEvent: event });
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.latest.onmessage?.({
      data: JSON.stringify({ status: PostStreamingStatus.STREAMING_END }),
    });
    await promise;
    expect(event).toHaveBeenCalledWith({ type: 'goodbye' });
    expect(usePostMessageStreaming.getState().errorDetail).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a connection timeout and clears timers', async () => {
    const promise = usePostMessageStreaming
      .getState()
      .post({ input, handleStreamingEvent: vi.fn() });
    const rejected = expect(promise).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15001);
    await rejected;
    expect(FakeSocket.latest.close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends numbered, byte-bounded frames after the handshake', async () => {
    const promise = usePostMessageStreaming
      .getState()
      .post({ input, handleStreamingEvent: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeSocket.latest;
    ws.onopen?.();
    ws.onmessage?.({ data: 'Session started.' });
    const frames = ws.send.mock.calls.map(([frame]) =>
      JSON.parse(frame as string)
    );
    expect(frames[0].step).toBe(PostStreamingStatus.START);
    expect(frames[1].index).toBe(0);
    expect(frames[1].part).toContain('smoke-test');
    ws.onmessage?.({
      data: JSON.stringify({ status: PostStreamingStatus.STREAMING_END }),
    });
    await promise;
  });
});

describe('stopping a response', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const begin = async () => {
    const promise = usePostMessageStreaming
      .getState()
      .post({ input, handleStreamingEvent: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.latest;
    socket.onopen?.();
    socket.onmessage?.({ data: 'Session started.' });
    socket.onmessage?.({ data: 'Message part received.' });
    return { promise, socket };
  };
  it('can stop immediately while authentication is still resolving', async () => {
    const promise = usePostMessageStreaming
      .getState()
      .post({ input, handleStreamingEvent: vi.fn() });
    usePostMessageStreaming.getState().stop();
    await expect(promise).resolves.toEqual({
      cancelled: true,
      persisted: false,
    });
    expect(usePostMessageStreaming.getState().isActive).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('can stop during the socket handshake without sending the model request', async () => {
    const promise = usePostMessageStreaming
      .getState()
      .post({ input, handleStreamingEvent: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.latest;
    usePostMessageStreaming.getState().stop();
    await expect(promise).resolves.toEqual({
      cancelled: true,
      persisted: false,
    });
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalled();
  });
  it('requests authenticated server cancellation once and waits for persisted completion', async () => {
    const { promise, socket } = await begin();
    usePostMessageStreaming.getState().stop();
    usePostMessageStreaming.getState().stop();
    expect(
      socket.send.mock.calls
        .map(([body]) => JSON.parse(body))
        .filter((frame) => frame.step === 'CANCEL')
    ).toEqual([{ step: 'CANCEL', token: 'synthetic-test-token' }]);
    socket.onmessage?.({ data: JSON.stringify({ status: 'STOP_REQUESTED' }) });
    expect(usePostMessageStreaming.getState().isActive).toBe(true);
    expect(usePostMessageStreaming.getState().isStopping).toBe(true);
    expect(socket.close).not.toHaveBeenCalled();
    socket.onmessage?.({
      data: JSON.stringify({
        status: PostStreamingStatus.STREAMING_END,
        stop_reason: 'cancelled',
      }),
    });
    await expect(promise).resolves.toEqual({
      cancelled: true,
      persisted: true,
    });
    expect(usePostMessageStreaming.getState().isStopping).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps a naturally completed response complete if Stop arrived too late', async () => {
    const { promise, socket } = await begin();
    usePostMessageStreaming.getState().stop();
    socket.onmessage?.({
      data: JSON.stringify({
        status: 'STOP_REJECTED',
        reason: 'Already finished',
      }),
    });
    socket.onmessage?.({
      data: JSON.stringify({
        status: PostStreamingStatus.STREAMING_END,
        stop_reason: 'end_turn',
      }),
    });
    await expect(promise).resolves.toEqual({
      cancelled: false,
      persisted: true,
    });
    expect(usePostMessageStreaming.getState().errorDetail).toBeNull();
  });
  it('does not report a successful stop if the connection disappears before confirmation', async () => {
    const { promise, socket } = await begin();
    const rejected = expect(promise).rejects.toThrow('Could not confirm');
    usePostMessageStreaming.getState().stop();
    socket.onclose?.();
    await rejected;
    expect(usePostMessageStreaming.getState().isActive).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('refuses a second in-flight request without losing the original stop control', async () => {
    const { promise, socket } = await begin();
    await expect(
      usePostMessageStreaming
        .getState()
        .post({ input, handleStreamingEvent: vi.fn() })
    ).rejects.toThrow('Another response');
    usePostMessageStreaming.getState().stop();
    expect(usePostMessageStreaming.getState().isStopping).toBe(true);
    socket.onmessage?.({
      data: JSON.stringify({
        status: PostStreamingStatus.STREAMING_END,
        stop_reason: 'cancelled',
      }),
    });
    await promise;
  });
});
