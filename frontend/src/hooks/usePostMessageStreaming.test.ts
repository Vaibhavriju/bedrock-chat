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
