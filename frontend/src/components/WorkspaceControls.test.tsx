// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SwitchBedrockModel from './SwitchBedrockModel';
import DrawerItem from './DrawerItem';
import ExpandableDrawerGroup from './ExpandableDrawerGroup';
import MenuSettings from './Menu';

const model = vi.hoisted(() => ({ setModelId: vi.fn() }));
vi.mock('../hooks/useModel', () => ({
  default: () => ({
    availableModels: [
      {
        modelId: 'claude-v4.6-sonnet',
        label: 'Claude Sonnet',
        description: 'Everyday work',
      },
      {
        modelId: 'amazon-nova-2-lite',
        label: 'Nova 2 Lite',
        description: 'Drafting',
      },
    ],
    modelId: 'claude-v4.6-sonnet',
    setModelId: model.setModelId,
    getDefaultModel: () => 'claude-v4.6-sonnet',
  }),
}));
vi.mock('../hooks/useLoginUser', () => ({
  default: () => ({ userName: 'Synthetic reviewer', userGroups: ['test'] }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let root: Root;
let host: HTMLDivElement;
const render = async (content: React.ReactNode) => {
  await act(async () => {
    root.render(content);
  });
};
const click = async (element: Element | null) => {
  expect(element).not.toBeNull();
  await act(async () => {
    (element as HTMLElement).click();
  });
};
const button = (text: string) =>
  [...document.querySelectorAll('button')].find((e) =>
    e.textContent?.includes(text)
  ) ?? null;

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
  model.setModelId.mockClear();
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  document.getElementById('headlessui-portal-root')?.remove();
  vi.unstubAllGlobals();
});

describe('workspace controls', () => {
  it('opens the model chooser in a labelled portal outside the clipped chat region', async () => {
    await render(
      <div style={{ overflow: 'hidden', height: 60 }}>
        <SwitchBedrockModel
          activeModels={
            { claudeV46Sonnet: true, amazonNova2Lite: true } as never
          }
        />
      </div>
    );
    await click(document.querySelector('[aria-label="Choose AI model"]'));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(host.contains(dialog)).toBe(false);
    expect(
      document.getElementById(dialog!.getAttribute('aria-labelledby')!)
        ?.textContent
    ).toBe('Choose AI model');
    await click(button('Nova 2 Lite'));
    expect(model.setModelId).toHaveBeenCalledWith('amazon-nova-2-lite');
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    );
  });

  it('closes the model chooser with Escape and returns focus to its trigger', async () => {
    await render(
      <SwitchBedrockModel activeModels={{ claudeV46Sonnet: true } as never} />
    );
    const trigger = document.querySelector(
      '[aria-label="Choose AI model"]'
    ) as HTMLElement;
    trigger.focus();
    await click(trigger);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('keeps conversation actions outside navigation links', async () => {
    const remove = vi.fn();
    await render(
      <MemoryRouter>
        <DrawerItem
          to="/synthetic-chat"
          icon={<span />}
          labelComponent="Conversation"
          actionComponent={<button onClick={remove}>Delete test</button>}
        />
      </MemoryRouter>
    );
    expect(document.querySelector('a button')).toBeNull();
    await click(button('Delete test'));
    expect(remove).toHaveBeenCalledOnce();
    expect(document.querySelector('a')?.getAttribute('href')).toBe(
      '/synthetic-chat'
    );
  });

  it('removes collapsed navigation groups from keyboard and accessibility navigation', async () => {
    await render(
      <ExpandableDrawerGroup label="Recent chats">
        <a href="/synthetic-chat">Synthetic chat</a>
      </ExpandableDrawerGroup>
    );
    await click(button('Recent chats'));
    const trigger = button('Recent chats');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('a')?.closest('[hidden]')).not.toBeNull();
    await click(trigger);
    expect(document.querySelector('a')?.closest('[hidden]')).toBeNull();
  });

  it('provides a keyboard menu and closes it after choosing an action', async () => {
    const onSelectLanguage = vi.fn();
    await render(
      <MenuSettings
        onSelectLanguage={onSelectLanguage}
        onSignOut={vi.fn()}
        onClickDrawerOptions={vi.fn()}
        onClearConversations={vi.fn()}
      />
    );
    const trigger = button('button.menu')!;
    await click(trigger);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await click(button('button.language'));
    expect(onSelectLanguage).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
