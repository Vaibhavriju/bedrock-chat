import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BaseProps } from '../@types/common';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import useDrawer from '../hooks/useDrawer';
import ButtonIcon from './ButtonIcon';
import {
  PiArrowRight,
  PiChartLine,
  PiChat,
  PiChatCenteredDotsDuotone,
  PiCheck,
  PiCompass,
  PiListBullets,
  PiNotePencil,
  PiPencilLine,
  PiPlugs,
  PiPresentationChart,
  PiRobot,
  PiTrash,
  PiX,
} from 'react-icons/pi';
import LazyOutputText from './LazyOutputText';
import { ConversationMeta } from '../@types/conversation';
import { BotListItem } from '../@types/bot';
import { Dialog } from '@headlessui/react';
import useChat from '../hooks/useChat';
import { useTranslation } from 'react-i18next';
import Menu from './Menu';
import DrawerItem from './DrawerItem';
import ExpandableDrawerGroup from './ExpandableDrawerGroup';
import { usePageLabel } from '../routes';
import Button from './Button';
import Skeleton from './Skeleton';
import { isPinnedBot } from '../utils/BotUtils';
import IconPinnedBot from './IconPinnedBot';
import useGlobalConfig from '../hooks/useGlobalConfig';

type Props = BaseProps & {
  isAdmin: boolean;
  conversations?: ConversationMeta[];
  pinnedBots?: BotListItem[];
  starredBots?: BotListItem[];
  recentlyUsedUnstarredBots?: BotListItem[];
  updateConversationTitle: (
    conversationId: string,
    title: string
  ) => Promise<void>;
  onSignOut: () => void;
  onDeleteConversation: (conversation: ConversationMeta) => void;
  onClearConversations: () => void;
  onSelectLanguage: () => void;
  onClickDrawerOptions: () => void;
};

type ItemProps = BaseProps & {
  label: string;
  conversationId: string;
  generatedTitle?: boolean;
  updateTitle: (conversationId: string, title: string) => Promise<void>;
  onClick: () => void;
  onDelete: () => void;
};

const Item: React.FC<ItemProps> = (props) => {
  const { pathname } = useLocation();
  const { conversationId: pathParam } = useParams();
  const { conversationId } = useChat();
  const [tempLabel, setTempLabel] = useState('');
  const [editing, setEditing] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const active = useMemo<boolean>(() => {
    return (
      pathParam === props.conversationId ||
      ((pathname === '/' || pathname.startsWith('/bot/')) &&
        conversationId == props.conversationId)
    );
  }, [conversationId, pathParam, pathname, props.conversationId]);

  const onClickEdit = useCallback(() => {
    setEditing(true);
    setTempLabel(props.label);
  }, [props.label]);

  const onClickUpdate = useCallback(() => {
    props.updateTitle(props.conversationId, tempLabel).then(() => {
      setEditing(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tempLabel, props.conversationId, props.updateTitle]);

  const onClickDelete = useCallback(() => {
    props.onDelete();
  }, [props]);

  useLayoutEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    }
  }, [editing]);

  useLayoutEffect(() => {
    if (editing) {
      const listener = (e: DocumentEventMap['keypress']) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();

          // dispatch 処理の中で Title の更新を行う（同期を取るため）
          setTempLabel((newLabel) => {
            props.updateTitle(props.conversationId, newLabel).then(() => {
              setEditing(false);
            });
            return newLabel;
          });
        }
      };
      inputRef.current?.addEventListener('keypress', listener);

      inputRef.current?.focus();

      return () => {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        inputRef.current?.removeEventListener('keypress', listener);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  return (
    <DrawerItem
      isActive={active}
      isEditing={editing}
      to={`/${props.conversationId}`}
      onClick={props.onClick}
      icon={<PiChat />}
      labelComponent={
        <>
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              aria-label="Conversation title"
              className="w-full bg-transparent"
              value={tempLabel}
              onChange={(e) => {
                setTempLabel(e.target.value);
              }}
            />
          ) : (
            <>
              {props.generatedTitle ? (
                <LazyOutputText text={props.label} />
              ) : (
                <>{props.label}</>
              )}
            </>
          )}
        </>
      }
      actionComponent={
        <>
          {active && !editing && (
            <>
              <ButtonIcon
                label="Rename conversation"
                className="text-base"
                onClick={onClickEdit}>
                <PiPencilLine />
              </ButtonIcon>

              <ButtonIcon
                label="Delete conversation"
                className="text-base"
                onClick={onClickDelete}>
                <PiTrash />
              </ButtonIcon>
            </>
          )}
          {editing && (
            <>
              <ButtonIcon
                label="Save conversation title"
                className="text-base"
                onClick={onClickUpdate}>
                <PiCheck />
              </ButtonIcon>

              <ButtonIcon
                label="Cancel rename"
                className="text-base"
                onClick={() => {
                  setEditing(false);
                }}>
                <PiX />
              </ButtonIcon>
            </>
          )}
        </>
      }
    />
  );
};

const Drawer: React.FC<Props> = (props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { getPageLabel } = usePageLabel();
  const { opened, close: closeDrawer, drawerOptions } = useDrawer();
  const { conversations, pinnedBots, starredBots, recentlyUsedUnstarredBots } =
    props;

  const location = useLocation();

  const [prevConversations, setPrevConversations] =
    useState<typeof conversations>();
  const [generateTitleIndex, setGenerateTitleIndex] = useState(-1);

  const { newChat, conversationId } = useChat();
  const { botId } = useParams();
  const { getGlobalConfig } = useGlobalConfig();
  const { data: globalConfig } = getGlobalConfig();
  const logoSrc = globalConfig?.logoPath ?? '';

  useEffect(() => {
    setPrevConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    // 新規チャットの場合はTitleをLazy表示にする
    if (!conversations || !prevConversations) {
      return;
    }
    if (conversations.length > prevConversations?.length) {
      setGenerateTitleIndex(
        conversations?.findIndex(
          (c) =>
            (prevConversations?.findIndex((pc) => c.id === pc.id) ?? -1) < 0
        ) ?? -1
      );
    }
  }, [conversations, prevConversations]);

  const onClickNewChat = useCallback(() => {
    newChat();
    closeSmallDrawer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onClickNewBotChat = useCallback(
    () => {
      newChat();
      closeSmallDrawer();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const closeSmallDrawer = useCallback(() => {
    closeDrawer();
  }, [closeDrawer]);

  const onClickLogo = useCallback(() => {
    navigate('/');
    closeSmallDrawer();
  }, [navigate, closeSmallDrawer]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const onResize = () => {
      if (desktop.matches) {
        closeDrawer();
      }
    };
    onResize();
    desktop.addEventListener('change', onResize);
    return () => desktop.removeEventListener('change', onResize);
  }, [closeDrawer]);

  const isAdminPanel = useMemo(() => {
    return location.pathname.startsWith('/admin');
  }, [location.pathname]);

  const sidebar = (
    <nav
      aria-label="Workspace navigation"
      className="flex size-full min-h-0 flex-col text-sm">
      {!logoSrc && (
        <button
          type="button"
          onClick={onClickLogo}
          className="workspace-brand flex w-full shrink-0 items-center gap-3 p-5 text-left"
          aria-label="BatteryPool AI home">
          <span className="flex size-10 items-center justify-center rounded-xl bg-aws-sea-blue-light font-bold text-white">
            BP
          </span>
          <span>
            <span className="block text-base font-semibold">
              BatteryPool AI
            </span>
            <span className="block text-xs opacity-55">Team workspace</span>
          </span>
        </button>
      )}
      {logoSrc && (
        <div className="flex shrink-0 items-center justify-center border-b border-gray/20 bg-white px-4 py-5 dark:bg-aws-paper-dark">
          <button
            type="button"
            onClick={onClickLogo}
            className="flex w-full items-center justify-center focus:ring-2 focus:ring-white/60 focus:ring-offset-2 focus:ring-offset-transparent focus:outline-hidden">
            <img
              src={logoSrc}
              alt={t('app.name')}
              className="h-10 w-auto max-w-[170px]"
              loading="lazy"
            />
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
        {!isAdminPanel && (
          <>
            {drawerOptions.show.newChat && (
              <DrawerItem
                isActive={false}
                icon={<PiNotePencil />}
                to="/"
                onClick={onClickNewChat}
                labelComponent={t('button.newChat')}
              />
            )}
            {drawerOptions.show.myBots && (
              <DrawerItem
                isActive={false}
                icon={<PiListBullets />}
                to="/bot/my"
                labelComponent={getPageLabel('/bot/my')}
                onClick={closeSmallDrawer}
              />
            )}
            {drawerOptions.show.discoverBots && (
              <DrawerItem
                isActive={false}
                icon={<PiCompass />}
                to="/bot/discover"
                labelComponent={getPageLabel('/bot/discover')}
                onClick={closeSmallDrawer}
              />
            )}

            {drawerOptions.show.pinnedBots &&
            pinnedBots?.filter((bot) => bot.available).length ? (
              <ExpandableDrawerGroup
                label={t('app.pinnedBots')}
                className="border-t bg-white pt-1 dark:bg-aws-paper-dark">
                {pinnedBots
                  .filter((bot) => bot.available)
                  .map((bot) => (
                    <DrawerItem
                      key={bot.id}
                      isActive={botId === bot.id && !conversationId}
                      to={`/bot/${bot.id}`}
                      icon={<IconPinnedBot showAlways />}
                      labelComponent={bot.title}
                      onClick={onClickNewBotChat}
                    />
                  ))}
              </ExpandableDrawerGroup>
            ) : null}

            {drawerOptions.show.starredBots && (
              <ExpandableDrawerGroup
                label={t('app.starredBots')}
                className="border-t bg-white pt-1 dark:bg-aws-paper-dark">
                {starredBots === undefined && (
                  <div className="flex flex-col gap-2 p-2">
                    <Skeleton className="h-10 w-full bg-aws-sea-blue-light/50 dark:bg-aws-sea-blue-dark/50" />
                    <Skeleton className="h-10 w-full bg-aws-sea-blue-light/50 dark:bg-aws-sea-blue-dark/50" />
                    <Skeleton className="h-10 w-full bg-aws-sea-blue-light/50 dark:bg-aws-sea-blue-dark/50" />
                    <Skeleton className="h-10 w-full bg-aws-sea-blue-light/50 dark:bg-aws-sea-blue-dark/50" />
                    <Skeleton className="h-10 w-full bg-aws-sea-blue-light/50 dark:bg-aws-sea-blue-dark/50" />
                  </div>
                )}
                {starredBots
                  ?.slice(0, drawerOptions.displayCount.starredBots)
                  .map((bot) => (
                    <DrawerItem
                      key={bot.id}
                      isActive={botId === bot.id && !conversationId}
                      to={`/bot/${bot.id}`}
                      icon={
                        isPinnedBot(bot.sharedStatus) ? (
                          <IconPinnedBot showAlways />
                        ) : (
                          <PiRobot />
                        )
                      }
                      labelComponent={bot.title}
                      onClick={onClickNewBotChat}
                    />
                  ))}

                {starredBots && starredBots.length > 15 && (
                  <Button
                    text
                    rightIcon={<PiArrowRight />}
                    className="w-full"
                    onClick={() => {
                      navigate('/bot/starred');
                      closeSmallDrawer();
                    }}>
                    {t('bot.button.viewAll')}
                  </Button>
                )}
              </ExpandableDrawerGroup>
            )}

            {drawerOptions.show.recentlyUsedBots && (
              <ExpandableDrawerGroup
                label={t('app.recentlyUsedBots')}
                className="border-t bg-white pt-1 dark:bg-aws-paper-dark">
                {recentlyUsedUnstarredBots === undefined && (
                  <div className="flex flex-col gap-2 p-2">
                    <Skeleton className="h-10 w-full bg-aws-sea-blue-light/50 dark:bg-aws-sea-blue-dark/50" />
                    <Skeleton className="h-10 w-full bg-aws-sea-blue-light/50 dark:bg-aws-sea-blue-dark/50" />
                    <Skeleton className="h-10 w-full bg-aws-sea-blue-light/50 dark:bg-aws-sea-blue-dark/50" />
                    <Skeleton className="h-10 w-full bg-aws-sea-blue-light/50 dark:bg-aws-sea-blue-dark/50" />
                    <Skeleton className="h-10 w-full bg-aws-sea-blue-light/50 dark:bg-aws-sea-blue-dark/50" />
                  </div>
                )}
                {recentlyUsedUnstarredBots
                  ?.slice(0, drawerOptions.displayCount.recentlyUsedBots)
                  .map((bot) => (
                    <DrawerItem
                      key={bot.id}
                      isActive={false}
                      to={`/bot/${bot.id}`}
                      icon={
                        isPinnedBot(bot.sharedStatus) ? (
                          <IconPinnedBot showAlways />
                        ) : (
                          <PiRobot />
                        )
                      }
                      labelComponent={bot.title}
                      onClick={onClickNewBotChat}
                    />
                  ))}

                {recentlyUsedUnstarredBots && (
                  <Button
                    text
                    rightIcon={<PiArrowRight />}
                    className="w-full"
                    onClick={() => {
                      navigate('/bot/recently-used');
                      closeSmallDrawer();
                    }}>
                    {t('bot.button.viewAll')}
                  </Button>
                )}
              </ExpandableDrawerGroup>
            )}

            {drawerOptions.show.conversationHistory && (
              <ExpandableDrawerGroup
                label={t('app.conversationHistory')}
                className="border-t bg-white pt-1 dark:bg-aws-paper-dark">
                {conversations === undefined && (
                  <div className="flex flex-col gap-2 p-2">
                    <Skeleton className="h-10 w-full bg-aws-sea-blue-light/50 dark:bg-aws-sea-blue-dark/50" />
                    <Skeleton className="h-10 w-full bg-aws-sea-blue-light/50 dark:bg-aws-sea-blue-dark/50" />
                    <Skeleton className="h-10 w-full bg-aws-sea-blue-light/50 dark:bg-aws-sea-blue-dark/50" />
                    <Skeleton className="h-10 w-full bg-aws-sea-blue-light/50 dark:bg-aws-sea-blue-dark/50" />
                    <Skeleton className="h-10 w-full bg-aws-sea-blue-light/50 dark:bg-aws-sea-blue-dark/50" />
                  </div>
                )}
                {conversations
                  ?.slice(0, drawerOptions.displayCount.conversationHistory)
                  .map((conversation, idx) => (
                    <Item
                      key={idx}
                      className="grow"
                      label={conversation.title}
                      conversationId={conversation.id}
                      generatedTitle={idx === generateTitleIndex}
                      updateTitle={props.updateConversationTitle}
                      onClick={closeSmallDrawer}
                      onDelete={() => props.onDeleteConversation(conversation)}
                    />
                  ))}

                {conversations && (
                  <Button
                    text
                    rightIcon={<PiArrowRight />}
                    className="w-full"
                    onClick={() => {
                      navigate('/conversations');
                      closeSmallDrawer();
                    }}>
                    {t('bot.button.viewAll')}
                  </Button>
                )}
              </ExpandableDrawerGroup>
            )}
          </>
        )}

        {isAdminPanel && (
          <>
            <div className="px-4 py-3 text-sm font-semibold opacity-60">
              {t('app.adminConsoles')}
            </div>
            <DrawerItem
              className="w-60"
              isActive={location.pathname === '/admin/shared-bot-analytics'}
              icon={<PiChartLine />}
              to="/admin/shared-bot-analytics"
              labelComponent={getPageLabel('/admin/shared-bot-analytics')}
              onClick={closeSmallDrawer}
            />
            <DrawerItem
              className="w-60"
              isActive={location.pathname === '/admin/api-management'}
              icon={<PiPlugs />}
              to="/admin/api-management"
              labelComponent={getPageLabel('/admin/api-management')}
              onClick={closeSmallDrawer}
            />
            <DrawerItem
              className="w-60"
              isActive={location.pathname === '/admin/models'}
              icon={<PiRobot />}
              to="/admin/models"
              labelComponent="Model catalog"
              onClick={closeSmallDrawer}
            />
          </>
        )}
      </div>
      <div className="relative shrink-0 border-t border-gray/20 bg-white py-2 dark:bg-aws-ui-color-dark">
        {props.isAdmin && !isAdminPanel && (
          <DrawerItem
            className="w-60"
            isActive={false}
            icon={<PiPresentationChart />}
            to="/admin/shared-bot-analytics"
            labelComponent={t('app.adminConsoles')}
            onClick={closeSmallDrawer}
          />
        )}
        {isAdminPanel && (
          <DrawerItem
            className="w-60"
            isActive={false}
            icon={<PiChatCenteredDotsDuotone />}
            to="/"
            labelComponent={t('app.backChat')}
            onClick={closeSmallDrawer}
          />
        )}
        <Menu
          className="mx-2 flex h-10 w-60 justify-start"
          onSignOut={props.onSignOut}
          onSelectLanguage={props.onSelectLanguage}
          onClearConversations={props.onClearConversations}
          onClickDrawerOptions={props.onClickDrawerOptions}
        />
      </div>
    </nav>
  );

  return (
    <>
      <aside className="workspace-sidebar hidden h-full min-h-0 w-64 shrink-0 border-r border-gray/20 bg-white text-aws-font-color-light lg:flex dark:bg-aws-ui-color-dark dark:text-aws-font-color-dark">
        {sidebar}
      </aside>
      <Dialog
        open={opened}
        onClose={closeDrawer}
        className="relative z-40 lg:hidden">
        <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
        <Dialog.Panel className="workspace-sidebar fixed inset-y-0 left-0 w-64 max-w-[calc(100vw-3rem)] bg-white text-aws-font-color-light shadow-xl dark:bg-aws-ui-color-dark dark:text-aws-font-color-dark">
          <Dialog.Title className="sr-only">Workspace navigation</Dialog.Title>
          {sidebar}
          <ButtonIcon
            label="Close sidebar"
            className="absolute top-2 -right-11 bg-white text-aws-font-color-light dark:bg-aws-ui-color-dark"
            onClick={closeDrawer}>
            <PiX />
          </ButtonIcon>
        </Dialog.Panel>
      </Dialog>
    </>
  );
};

export default Drawer;
