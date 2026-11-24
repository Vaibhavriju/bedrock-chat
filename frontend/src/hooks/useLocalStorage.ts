import { useCallback, useEffect, useState } from 'react';

const CHANGE_EVENT = 'workspace-storage-change';
const useLocalStorage = (key: string, defaultValue: string) => {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    const refresh = () => {
      try {
        setValue(localStorage.getItem(key) ?? defaultValue);
      } catch {
        /* Storage can be unavailable in restricted browser contexts. */
      }
    };
    window.addEventListener('storage', refresh);
    window.addEventListener(CHANGE_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(CHANGE_EVENT, refresh);
    };
  }, [key, defaultValue]);

  const setValueWrapper = useCallback(
    (next: string) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
        // Keep desktop/mobile menus and the application theme in sync in this tab.
        window.dispatchEvent(new Event(CHANGE_EVENT));
      } catch {
        /* Keep the preference usable for this session if storage is blocked. */
      }
    },
    [key]
  );

  return [value, setValueWrapper] as const;
};
export default useLocalStorage;
