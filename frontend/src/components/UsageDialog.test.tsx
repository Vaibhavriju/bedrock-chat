// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import UsageDialog from './UsageDialog';
const mocks = vi.hoisted(() => ({ once: vi.fn() }));
vi.mock('../hooks/useHttp', () => ({
  default: () => ({
    getOnce: mocks.once,
    get: () => {
      throw new Error('Private usage must not use a shared cache');
    },
  }),
}));
let root: Root;
let host: HTMLDivElement;
const snapshot = (count: number) => ({
  configured: true,
  timezone: 'Asia/Kolkata',
  day: '2026-11-24',
  month: '2026-11',
  model: 'gpt-6.2-astra',
  notice: 'Generation requests only.',
  scopes: [
    {
      scope: 'Your account',
      day: count,
      month: count,
      dailyRequests: 100,
      monthlyRequests: null,
      maxOutputTokens: null,
    },
  ],
});
async function open() {
  await act(async () =>
    root.render(<UsageDialog model="gpt-6.2-astra" onClose={vi.fn()} />)
  );
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.once.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.getElementById('headlessui-portal-root')?.remove();
  vi.unstubAllGlobals();
});
it('fetches fresh private usage on every opening and never reuses another session’s cached counts', async () => {
  mocks.once.mockResolvedValueOnce({ data: snapshot(42) });
  await open();
  expect(document.body.textContent).toContain('42 / 100');
  await act(async () => root.render(null));
  mocks.once.mockResolvedValueOnce({ data: snapshot(8) });
  await open();
  expect(mocks.once).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).toContain('8 / 100');
  expect(document.body.textContent).not.toContain('42 / 100');
  expect(mocks.once.mock.calls[1][1]).toEqual({ model: 'gpt-6.2-astra' });
});
it('cancels an unfinished private usage read when closed', async () => {
  mocks.once.mockImplementation(() => new Promise(() => {}));
  await open();
  const signal = mocks.once.mock.calls[0][3] as AbortSignal;
  expect(signal.aborted).toBe(false);
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
