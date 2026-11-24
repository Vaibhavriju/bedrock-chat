// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AdminLimitsPage from './AdminLimitsPage';
import { emptyRule } from '../@types/usage-control';

const mocks = vi.hoisted(() => ({
  admin: true,
  data: {} as unknown,
  put: vi.fn(),
  mutate: vi.fn(),
  once: vi.fn(),
}));
const models = [
  { modelId: 'claude-v5.5-sonnet', label: 'Claude Sonnet 5.5' },
  { modelId: 'gpt-6.2-astra', label: 'GPT-6.2 Astra' },
];
vi.mock('../hooks/useLoginUser', () => ({
  default: () => ({ isAdmin: mocks.admin, userName: 'admin@batterypool.com' }),
}));
vi.mock('../hooks/useModel', () => ({
  default: () => ({ availableModels: models }),
}));
vi.mock('../hooks/useHttp', () => ({
  default: () => ({
    get: () => ({ data: mocks.data, mutate: mocks.mutate }),
    put: mocks.put,
    getOnce: mocks.once,
  }),
}));
let host: HTMLDivElement;
let root: Root;
const button = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;
const input = (label: string) =>
  host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
async function change(label: string, value: string) {
  await act(async () => {
    const element = input(label);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function render() {
  await act(async () => root.render(<AdminLimitsPage />));
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function save() {
  await act(async () => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.admin = true;
  mocks.data = {
    configured: true,
    timezone: 'Asia/Kolkata',
    policy: {
      revision: 2,
      workspace: emptyRule(),
      defaultUser: emptyRule(),
      models: {},
      users: {},
    },
  };
  mocks.put.mockReset();
  mocks.once.mockReset();
  mocks.once.mockImplementation(async () => ({ data: mocks.data }));
  mocks.mutate.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('has no implicit caps and does not let a non-admin edit limits', async () => {
  await render();
  expect(input('Workspace: Requests per day').value).toBe('');
  expect(button('Save limits').disabled).toBe(true);
  mocks.admin = false;
  await render();
  expect(host.textContent).toContain('Only workspace administrators');
  expect(host.querySelector('form')).toBeNull();
});
it('saves numeric workspace and employee caps without replacing the revision', async () => {
  await render();
  await change('Workspace: Requests per day', '100');
  await change('Employee default: Requests per month', '500');
  mocks.put.mockImplementation(async (_path, policy) => {
    const saved = { ...policy, revision: 3 };
    mocks.data = { ...(mocks.data as object), policy: saved };
    return { data: saved };
  });
  await save();
  expect(mocks.put.mock.calls[0][0]).toBe('admin/limits');
  expect(mocks.put.mock.calls[0][1].revision).toBe(2);
  expect(mocks.put.mock.calls[0][1].workspace.dailyRequests).toBe(100);
  expect(mocks.put.mock.calls[0][1].defaultUser.monthlyRequests).toBe(500);
  expect(host.textContent).toContain('Limits saved');
});
it('preserves the draft and explains a conflict when another administrator saved first', async () => {
  await render();
  await change('Workspace: Requests per month', '1000');
  mocks.put.mockRejectedValue({
    isAxiosError: true,
    response: {
      status: 409,
      data: {
        errors: ['Someone changed these limits. Reload before saving again.'],
      },
    },
  });
  await save();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'Someone changed'
  );
  expect(input('Workspace: Requests per month').value).toBe('1000');
  expect(button('Save limits').disabled).toBe(false);
});
it('adds an employee override and model access choices without creating an account', async () => {
  await render();
  await change('Employee email', 'person@batterypool.com');
  await click('Add override');
  expect(host.textContent).toContain('person@batterypool.com');
  expect(mocks.put).not.toHaveBeenCalled();
  expect(host.textContent).toContain('does not create an employee account');
});
