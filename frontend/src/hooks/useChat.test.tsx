// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  mutate: vi.fn(async () => undefined),
  title: vi.fn(async () => undefined),
  generatedTitle: vi.fn(async () => undefined),
  sync: vi.fn(async () => undefined),
  models: [{ modelId: 'claude-v4.6-sonnet', supportReasoning: false }],
}));
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: async () => ({
    tokens: { idToken: { toString: () => 'synthetic-token' } },
  }),
}));
vi.mock('./useConversationApi', () => ({
  default: () => ({
    getConversation: () => ({
      data: undefined,
      mutate: mocks.mutate,
      isLoading: false,
      error: undefined,
    }),
    getRelatedDocuments: () => ({
      data: [],
      mutate: mocks.mutate,
      isLoading: false,
    }),
    updateTitle: mocks.title,
    updateTitleWithGeneratedTitle: mocks.generatedTitle,
  }),
}));
vi.mock('./useConversation', () => ({
  default: () => ({ syncConversations: mocks.sync }),
}));
vi.mock('./useFeedbackApi', () => ({
  default: () => ({ putFeedback: vi.fn() }),
}));
vi.mock('./useModel', () => ({
  default: () => ({
    modelId: 'claude-v4.6-sonnet',
    setModelId: vi.fn(),
    availableModels: mocks.models,
  }),
}));
vi.stubEnv('VITE_APP_USE_STREAMING', 'true');
const { default: useChat } = await import('./useChat');
let current: ReturnType<typeof useChat>;
let host: HTMLDivElement;
let root: Root;
class Socket {
  static latest: Socket;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  send = vi.fn();
  close = vi.fn(() => this.onclose?.());
  constructor() {
    Socket.latest = this;
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}
function Probe() {
  current = useChat();
  return (
    <div>
      {current.messages
        .map((m) =>
          m.content
            .filter((c) => c.contentType === 'text')
            .map((c) => c.body)
            .join('')
        )
        .join('|')}
    </div>
  );
}
const handshake = async () => {
  await act(async () => {
    const s = Socket.latest;
    s.onopen?.();
    s.onmessage?.({ data: 'Session started.' });
    s.onmessage?.({ data: 'Message part received.' });
  });
};
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('WebSocket', Socket);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  mocks.title.mockClear();
  mocks.generatedTitle.mockClear();
  mocks.sync.mockClear();
  await act(async () => {
    root.render(<Probe />);
  });
  await act(async () => {
    current.newChat();
  });
});
afterEach(async () => {
  await act(async () => {
    Socket.latest?.message({
      status: 'STREAMING_END',
      stop_reason: 'cancelled',
    });
  });
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
});
it('keeps a stopped partial answer and uses a simple title without another model request', async () => {
  await act(async () => {
    current.postChat({ content: 'Accidental prompt', enableReasoning: false });
  });
  await handshake();
  await act(async () => {
    Socket.latest.message({
      status: 'STREAMING',
      completion: 'Visible partial answer',
    });
  });
  await act(async () => {
    current.stopGeneration();
    Socket.latest.message({
      status: 'STREAMING_END',
      stop_reason: 'cancelled',
    });
  });
  expect(current.messages[current.messages.length - 1]?.stopped).toBe(true);
  expect(host.textContent).toContain('Visible partial answer');
  expect(mocks.generatedTitle).not.toHaveBeenCalled();
  expect(mocks.title).toHaveBeenCalledWith(
    expect.any(String),
    'Accidental prompt'
  );
  expect(current.postingMessage).toBe(false);
});
it('allows a quick resend after Stop and preserves the attached files', async () => {
  await act(async () => {
    current.postChat({
      content: 'Original prompt',
      enableReasoning: false,
      attachments: [
        {
          fileName: 'code.ts',
          fileType: '',
          extractedContent: '',
          objectKey: `chat-attachments/user/${'a'.repeat(32)}/manifest.json`,
        },
      ],
    });
    current.stopGeneration();
  });
  expect(current.conversationId).toBe('');
  expect(current.messages[current.messages.length - 1]?.stopped).toBe(true);
  await act(async () => {
    current.regenerate({ content: 'Corrected prompt', enableReasoning: false });
  });
  await handshake();
  const body = Socket.latest.send.mock.calls
    .map(([value]) => JSON.parse(value))
    .filter((frame) => frame.part)
    .map((frame) => frame.part)
    .join('');
  expect(body).toContain('Corrected prompt');
  expect(body).toContain('code.ts');
  await act(async () => {
    Socket.latest.message({ status: 'STREAMING', completion: 'Fresh answer' });
    Socket.latest.message({ status: 'STREAMING_END', stop_reason: 'end_turn' });
  });
  expect(host.textContent).toContain('Fresh answer');
  expect(current.messages[current.messages.length - 1]?.stopped).not.toBe(true);
});
it('does not put a cancelled old answer into a newly opened conversation', async () => {
  await act(async () => {
    current.postChat({ content: 'Old prompt', enableReasoning: false });
  });
  await handshake();
  await act(async () => {
    current.newChat();
    Socket.latest.message({
      status: 'STREAMING',
      completion: 'Old request must stay out of the new chat',
    });
    Socket.latest.message({
      status: 'STREAMING_END',
      stop_reason: 'cancelled',
    });
  });
  expect(current.conversationId).toBe('');
  expect(current.messages).toEqual([]);
  expect(host.textContent).not.toContain('Old request must stay out');
});
