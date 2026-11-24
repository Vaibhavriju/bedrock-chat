// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InputChatContent from './InputChatContent';

const uploads = vi.hoisted(() => ({
  items: [] as unknown[],
  busy: false,
  hasErrors: false,
  add: vi.fn(() => []),
  clear: vi.fn(),
  retry: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../hooks/useAttachmentUploads', () => ({ default: () => uploads }));
vi.mock('../hooks/useModel', () => ({
  default: () => ({
    disabledImageUpload: false,
    model: { modelId: 'claude-v4.6-sonnet', supportMediaType: [] },
    acceptMediaType: [],
    forceReasoningEnabled: false,
  }),
}));
vi.mock('../hooks/useSnackbar', () => ({ default: () => ({ open: vi.fn() }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let host: HTMLDivElement;
let root: Root;
const send = vi.fn();
async function render() {
  await act(async () => {
    root.render(
      <InputChatContent
        canRegenerate={false}
        canContinue={false}
        isLoading={false}
        onSend={send}
        onRegenerate={vi.fn()}
        continueGenerate={vi.fn()}
        supportReasoning={false}
        reasoningEnabled={false}
        onChangeReasoning={vi.fn()}
        suggestedPrompt={{ text: 'Synthetic draft', id: 1 }}
      />
    );
  });
}
async function key(target: Element, type: string, props: KeyboardEventInit) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent(type, { bubbles: true, cancelable: true, ...props })
    );
  });
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  uploads.items = [];
  send.mockClear();
  uploads.remove.mockClear();
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
});

describe('composer submission boundaries', () => {
  it('sends from the text field on Enter and clears the submitted draft', async () => {
    await render();
    const input = host.querySelector('textarea')!;
    expect(input.value).toBe('Synthetic draft');
    await key(input, 'keydown', { key: 'Enter' });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toBe('Synthetic draft');
    expect(input.value).toBe('');
  });
  it('does not send on Shift+Enter or while an IME is composing', async () => {
    await render();
    const input = host.querySelector('textarea')!;
    await key(input, 'keydown', { key: 'Enter', shiftKey: true });
    await key(input, 'keydown', { key: 'Enter', isComposing: true });
    expect(send).not.toHaveBeenCalled();
    expect(input.value).toBe('Synthetic draft');
  });
  it('does not submit a message when Enter activates a file control', async () => {
    uploads.items = [
      {
        id: 'synthetic-file',
        file: { name: 'test.txt' },
        size: 10,
        status: 'ready',
        ready: {
          fileName: 'test.txt',
          objectKey: 'synthetic-key',
          kind: 'text',
          characters: 10,
          notice: 'Extracted text',
        },
      },
    ];
    await render();
    const remove = host.querySelector('[aria-label="Remove test.txt"]')!;
    await key(remove, 'keypress', { key: 'Enter' });
    await act(async () => {
      (remove as HTMLElement).click();
    });
    expect(uploads.remove).toHaveBeenCalledWith('synthetic-file');
    expect(send).not.toHaveBeenCalled();
  });
});
