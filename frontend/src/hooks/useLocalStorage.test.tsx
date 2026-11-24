// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useLocalStorage from './useLocalStorage';

let root: Root;
let host: HTMLDivElement;
function Preference() {
  const [theme, setTheme] = useLocalStorage('theme', 'light');
  return <button onClick={() => setTheme('dark')}>{theme}</button>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('synchronizes the application and both navigation menus in one tab', async () => {
  await act(async () => {
    root.render(
      <>
        <Preference />
        <Preference />
      </>
    );
  });
  await act(async () => {
    host.querySelector('button')!.click();
  });
  expect(
    [...host.querySelectorAll('button')].map((button) => button.textContent)
  ).toEqual(['dark', 'dark']);
  expect(localStorage.getItem('theme')).toBe('dark');
});
it('keeps the app usable when browser preference storage is blocked', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Blocked', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Blocked', 'SecurityError');
  });
  await act(async () => {
    root.render(<Preference />);
  });
  expect(host.querySelector('button')?.textContent).toBe('light');
  await act(async () => {
    host.querySelector('button')!.click();
  });
  expect(host.querySelector('button')?.textContent).toBe('dark');
});
