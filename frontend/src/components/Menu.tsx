import React from 'react';
import { Menu } from '@headlessui/react';
import {
  PiList,
  PiSidebar,
  PiSignOut,
  PiTranslate,
  PiTrash,
} from 'react-icons/pi';
import { IoMoonSharp, IoSunnyOutline } from 'react-icons/io5';
import { useTranslation } from 'react-i18next';
import { BaseProps } from '../@types/common';
import { twMerge } from 'tailwind-merge';
import useLoginUser from '../hooks/useLoginUser';
import useLocalStorage from '../hooks/useLocalStorage';

type Props = BaseProps & {
  onSignOut: () => void;
  onSelectLanguage: () => void;
  onClickDrawerOptions: () => void;
  onClearConversations: () => void;
};

const MenuSettings: React.FC<Props> = (props) => {
  const { t } = useTranslation();
  const { userGroups, userName } = useLoginUser();
  const [theme, setTheme] = useLocalStorage('theme', 'light');
  const isDarkTheme = theme === 'dark';
  const actions = [
    {
      label: t('button.drawerOption'),
      icon: PiSidebar,
      run: props.onClickDrawerOptions,
    },
    {
      label: t('button.language'),
      icon: PiTranslate,
      run: props.onSelectLanguage,
    },
    {
      label: isDarkTheme ? 'Use light theme' : 'Use dark theme',
      icon: isDarkTheme ? IoSunnyOutline : IoMoonSharp,
      run: () => {
        const next = isDarkTheme ? 'light' : 'dark';
        document.documentElement.className = next;
        setTheme(next);
      },
    },
    {
      label: t('button.clearConversation'),
      icon: PiTrash,
      run: props.onClearConversations,
    },
    { label: t('button.signOut'), icon: PiSignOut, run: props.onSignOut },
  ];
  return (
    <Menu as="div" className="relative">
      <Menu.Button
        className={twMerge(
          'mx-2 flex min-h-10 w-60 items-center gap-2 rounded-xl px-3 text-left hover:bg-aws-sea-blue-light/5 dark:hover:bg-aws-paper-dark',
          props.className
        )}>
        <PiList aria-hidden="true" />
        {t('button.menu')}
      </Menu.Button>
      <Menu.Items className="absolute bottom-full left-2 z-50 mb-2 max-h-[calc(100dvh-6rem)] w-60 overflow-y-auto rounded-xl border border-gray/20 bg-white p-1 text-aws-font-color-light shadow-xl dark:bg-aws-ui-color-dark dark:text-aws-font-color-dark">
        <div className="border-b border-gray/20 px-3 py-2 text-sm">
          <p className="font-semibold wrap-break-word">{userName}</p>
          {userGroups.length > 0 && (
            <p className="mt-1 text-xs wrap-break-word opacity-65">
              {userGroups.join(', ')}
            </p>
          )}
        </div>
        {actions.map(({ label, icon: Icon, run }) => (
          <Menu.Item key={label}>
            {({ active }) => (
              <button
                type="button"
                onClick={run}
                className={twMerge(
                  'flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm',
                  active && 'bg-aws-sea-blue-light/10'
                )}>
                <Icon aria-hidden="true" />
                {label}
              </button>
            )}
          </Menu.Item>
        ))}
      </Menu.Items>
    </Menu>
  );
};

export default MenuSettings;
