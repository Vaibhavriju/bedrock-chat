import { afterEach, expect, it, vi } from 'vitest';
import { copyText } from '../copyText';
const fallback = vi.hoisted(() => vi.fn());
vi.mock('copy-to-clipboard', () => ({ default: fallback }));
afterEach(() => {
  vi.unstubAllGlobals();
  fallback.mockReset();
});
it('uses the modern clipboard and preserves exact source text', async () => {
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  await copyText('code[^literal] 😀');
  expect(writeText).toHaveBeenCalledWith('code[^literal] 😀');
  expect(fallback).not.toHaveBeenCalled();
});
it('uses the legacy fallback if clipboard permissions are denied', async () => {
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: async () => {
        throw new Error('denied');
      },
    },
  });
  fallback.mockReturnValue(true);
  await copyText('exact');
  expect(fallback).toHaveBeenCalledWith('exact');
});
it('reports failure when neither clipboard route succeeded', async () => {
  vi.stubGlobal('navigator', {});
  fallback.mockReturnValue(false);
  await expect(copyText('exact')).rejects.toThrow('Copy failed');
});
