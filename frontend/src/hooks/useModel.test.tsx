// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useModel from './useModel';
const mocks = vi.hoisted(() => ({
  config: undefined as Record<string, unknown> | undefined,
  t: (key: string) => key,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('./useGlobalConfig', () => ({
  default: () => ({ getGlobalConfig: () => ({ data: mocks.config }) }),
}));
let current: ReturnType<typeof useModel>;
let root: Root;
let host: HTMLDivElement;
function Harness() {
  current = useModel();
  return null;
}
async function render() {
  await act(async () => root.render(<Harness />));
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.config = undefined;
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it('does not flash unverified models while the workspace policy is loading', async () => {
  await render();
  expect(current.availableModels).toEqual([]);
  expect(current.isLoadingModels).toBe(true);
});
it('an explicitly empty employee allowlist never falls back to all models', async () => {
  mocks.config = { modelAccessConfigured: true, globalAvailableModels: [] };
  await render();
  expect(current.availableModels).toEqual([]);
  expect(current.isLoadingModels).toBe(false);
});
it('replaces a remembered model if a policy refresh removes it', async () => {
  mocks.config = {
    modelAccessConfigured: true,
    globalAvailableModels: ['gpt-6.2-astra', 'claude-v5.5-sonnet'],
    defaultModel: 'claude-v5.5-sonnet',
  };
  await render();
  await act(async () => current.setModelId('gpt-6.2-astra'));
  expect(current.modelId).toBe('gpt-6.2-astra');
  mocks.config = {
    modelAccessConfigured: true,
    globalAvailableModels: ['claude-v5.5-sonnet'],
    defaultModel: 'claude-v5.5-sonnet',
  };
  await render();
  expect(current.modelId).toBe('claude-v5.5-sonnet');
  expect(current.model?.modelId).toBe('claude-v5.5-sonnet');
});
