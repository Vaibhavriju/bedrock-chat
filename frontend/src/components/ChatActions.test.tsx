// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ButtonSend from './ButtonSend';
import ButtonCopy from './ButtonCopy';
const mocks = vi.hoisted(() => ({ copy: vi.fn() }));
vi.mock('../utils/copyText', () => ({ copyText: mocks.copy }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  mocks.copy.mockReset();
  mocks.copy.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
});
it('keeps Stop enabled while Send is disabled during generation', async () => {
  const stop = vi.fn(),
    send = vi.fn();
  await act(async () => {
    root.render(<ButtonSend loading disabled onClick={send} onStop={stop} />);
  });
  const button = host.querySelector('button')!;
  expect(button.disabled).toBe(false);
  expect(button.getAttribute('aria-label')).toBe('Stop generation');
  await act(async () => {
    button.click();
  });
  expect(stop).toHaveBeenCalledOnce();
  expect(send).not.toHaveBeenCalled();
});
it('shows stopping until the response is safely finalized', async () => {
  await act(async () => {
    root.render(
      <ButtonSend loading stopping onClick={vi.fn()} onStop={vi.fn()} />
    );
  });
  expect(host.querySelector('button')?.disabled).toBe(true);
  expect(host.querySelector('button')?.getAttribute('aria-label')).toBe(
    'Stopping generation'
  );
});
it('copies the exact code and citations rather than deleting bracket expressions', async () => {
  const text = 'const pattern = "[^literal]";\nSecond block[^source]';
  await act(async () => {
    root.render(<ButtonCopy text={text} />);
  });
  await act(async () => {
    host.querySelector('button')!.click();
  });
  expect(mocks.copy).toHaveBeenCalledWith(text);
  expect(host.querySelector('button')?.getAttribute('aria-label')).toBe(
    'Copied'
  );
});
it('reports denied clipboard access without displaying Copied', async () => {
  mocks.copy.mockRejectedValue(new Error('denied'));
  await act(async () => {
    root.render(<ButtonCopy text="test" />);
  });
  await act(async () => {
    host.querySelector('button')!.click();
  });
  expect(host.querySelector('button')?.getAttribute('aria-label')).toContain(
    'Copy failed'
  );
  expect(host.textContent).not.toContain('Copied to clipboard');
});
