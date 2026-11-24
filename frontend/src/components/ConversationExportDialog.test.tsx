// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ConversationExportDialog from './ConversationExportDialog';
import { DisplayMessageContent } from '../@types/conversation';
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  copy: vi.fn(),
  download: vi.fn(),
}));
vi.mock('../hooks/useHttp', () => ({
  default: () => ({ getOnce: mocks.load }),
}));
vi.mock('../utils/copyText', () => ({
  copyText: mocks.copy,
  downloadText: mocks.download,
}));
let root: Root;
let host: HTMLDivElement;
const messages: DisplayMessageContent[] = [
  {
    id: 'u',
    role: 'user',
    model: 'claude-v4.6-sonnet',
    parent: null,
    children: [],
    sibling: ['u'],
    feedback: null,
    usedChunks: null,
    thinkingLog: null,
    content: [
      { contentType: 'text', body: 'My portable prompt' },
      {
        contentType: 'attachment',
        fileName: 'note.txt',
        body: '',
        objectKey: `chat-attachments/user/${'a'.repeat(32)}/manifest.json`,
      },
    ],
  },
];
const button = (text: string) =>
  [...document.querySelectorAll('button')].find((e) => e.textContent === text)!;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  mocks.load.mockReset();
  mocks.copy.mockReset();
  mocks.download.mockReset();
  mocks.load.mockResolvedValue({
    data: {
      filename: 'note.txt',
      kind: 'text',
      characters: 25004,
      textBase64: btoa('X'.repeat(25000) + 'TAIL'),
    },
  });
  mocks.copy.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  document.getElementById('headlessui-portal-root')?.remove();
  vi.unstubAllGlobals();
});
const render = async () => {
  await act(async () => {
    root.render(
      <ConversationExportDialog isOpen messages={messages} onClose={vi.fn()} />
    );
  });
};
it('copies the complete file even though its preview is limited', async () => {
  await render();
  expect(
    (document.querySelector('textarea') as HTMLTextAreaElement).value
  ).toHaveLength(20000);
  await act(async () => {
    button('Copy all').click();
  });
  expect(mocks.copy.mock.calls[0][0]).toContain('TAIL');
  expect(mocks.copy.mock.calls[0][0]).toContain('My portable prompt');
  expect(document.body.textContent).toContain('Copied the entire export');
  await act(async () => {
    button('Download').click();
  });
  expect(mocks.download.mock.calls[0][0]).toContain('TAIL');
});
it('supports JSON export and reports a clipboard failure without success feedback', async () => {
  mocks.copy.mockRejectedValue(new Error('denied'));
  await render();
  const select = document.querySelector('select')!;
  await act(async () => {
    select.value = 'json';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {
    button('Copy all').click();
  });
  expect(JSON.parse(mocks.copy.mock.calls[0][0]).messages[0].text).toBe(
    'My portable prompt'
  );
  expect(document.body.textContent).toContain('Copy failed');
  expect(document.body.textContent).not.toContain('Copied the entire export');
});
it('reports inaccessible file content while allowing the available conversation to be copied', async () => {
  mocks.load.mockRejectedValue(new Error('not available'));
  await render();
  expect(document.body.textContent).toContain('1 file(s) need attention');
  await act(async () => {
    button('Copy all').click();
  });
  expect(mocks.copy.mock.calls[0][0]).toContain(
    'Attachment text could not be loaded'
  );
});
