import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useRef,
} from 'react';
import InputChatContent from '../components/InputChatContent';
import useChat from '../hooks/useChat';
import { AttachmentType } from '../hooks/useChat';
import ChatMessage from '../components/ChatMessage';
import useScroll from '../hooks/useScroll';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PiArrowsCounterClockwise,
  PiArrowDown,
  PiExport,
  PiPenNib,
  PiWarningCircleFill,
} from 'react-icons/pi';
import Button from '../components/Button';
import { useTranslation } from 'react-i18next';
import SwitchBedrockModel from '../components/SwitchBedrockModel';
import useSnackbar from '../hooks/useSnackbar';
import useBot from '../hooks/useBot';
import useConversation from '../hooks/useConversation';
import { ActiveModels, BotSummary } from '../@types/bot';
import IconPinnedBot from '../components/IconPinnedBot.tsx';

import { copyBotUrl, isPinnedBot, canBePinned } from '../utils/BotUtils';
import { toCamelCase } from '../utils/StringUtils';
import { produce } from 'immer';
import StatusSyncBot from '../components/StatusSyncBot';
import Alert from '../components/Alert';
import useBotSummary from '../hooks/useBotSummary';
import useModel from '../hooks/useModel';
import { StreamingState } from '../hooks/xstates/streaming.ts';
import { AgentToolsProps } from '../features/agent/types';
import { getRelatedDocumentsOfToolUse } from '../features/agent/utils/AgentUtils';
import { SyncStatus } from '../constants';
import { BottomHelper } from '../features/helper/components/BottomHelper';
import { useIsWindows } from '../hooks/useIsWindows';
import {
  DisplayMessageContent,
  Model,
  PutFeedbackRequest,
  RelatedDocument,
} from '../@types/conversation.ts';
import { AVAILABLE_MODEL_KEYS } from '../constants/index';
import usePostMessageStreaming from '../hooks/usePostMessageStreaming.ts';
import useLoginUser from '../hooks/useLoginUser';
import useBotPinning from '../hooks/useBotPinning';
import Skeleton from '../components/Skeleton.tsx';
import { twMerge } from 'tailwind-merge';
import ButtonStar from '../components/ButtonStar.tsx';
import MenuBot from '../components/MenuBot.tsx';
import ChatWelcome from '../components/ChatWelcome';
import ConversationExportDialog from '../components/ConversationExportDialog';

// ChatMessageWithRelatedDocuments component moved outside to prevent re-creation on every render
type ChatMessageWithRelatedDocumentsProps = {
  chatContent: DisplayMessageContent;
  isStreaming: boolean;
  streamingReasoning: string;
  streamingTools: AgentToolsProps[];
  streamingRelatedDocuments: RelatedDocument[];
  streamingStateValue: string;
  botHasAgent: boolean;
  botHasKnowledge: boolean;
  relatedDocuments: RelatedDocument[];
  onChangeMessageId?: (messageId: string) => void;
  onSubmit?: (messageId: string, content: string) => void;
  onSubmitFeedback?: (messageId: string, feedback: PutFeedbackRequest) => void;
  onExportTurn?: () => void;
};

const ChatMessageWithRelatedDocuments: React.FC<ChatMessageWithRelatedDocumentsProps> =
  React.memo((props) => {
    const { t } = useTranslation();
    const { chatContent: message } = props;

    const isAgentThinking = useMemo(() => {
      switch (props.streamingStateValue) {
        case StreamingState.STREAMING:
        case StreamingState.LEAVING:
          return props.isStreaming;
        default:
          return false;
      }
    }, [props.streamingStateValue, props.isStreaming]);

    const reasoning = useMemo(
      () => (isAgentThinking ? props.streamingReasoning : ''),
      [isAgentThinking, props.streamingReasoning]
    );

    const tools: AgentToolsProps[] | undefined = useMemo(() => {
      if (isAgentThinking) {
        if (props.streamingTools.length > 0) {
          return props.streamingTools;
        }

        if (props.botHasAgent) {
          return [{ thought: t('agent.progress.label'), tools: {} }];
        }

        if (props.botHasKnowledge) {
          return [{ thought: t('bot.label.retrievingKnowledge'), tools: {} }];
        }

        return undefined;
      } else {
        if (props.botHasKnowledge) {
          const pseudoToolUseId = message.id;
          const relatedDocumentsOfVectorSearch = getRelatedDocumentsOfToolUse(
            props.relatedDocuments,
            pseudoToolUseId
          );
          if (
            relatedDocumentsOfVectorSearch != null &&
            relatedDocumentsOfVectorSearch.length > 0
          ) {
            return [
              {
                tools: {
                  [pseudoToolUseId]: {
                    name: 'knowledge_base_tool',
                    status: 'success',
                    input: {},
                    relatedDocuments: relatedDocumentsOfVectorSearch,
                  },
                },
              },
            ];
          }
        }
        return undefined;
      }
    }, [
      isAgentThinking,
      props.streamingTools,
      props.botHasAgent,
      props.botHasKnowledge,
      message.id,
      props.relatedDocuments,
      t,
    ]);

    const relatedDocumentsForCitation = useMemo(
      () =>
        isAgentThinking
          ? props.streamingRelatedDocuments
          : props.relatedDocuments,
      [isAgentThinking, props.streamingRelatedDocuments, props.relatedDocuments]
    );

    return (
      <ChatMessage
        tools={tools}
        reasoning={reasoning}
        chatContent={message}
        isStreaming={props.isStreaming}
        relatedDocuments={relatedDocumentsForCitation}
        onChangeMessageId={props.onChangeMessageId}
        onSubmit={props.onSubmit}
        onSubmitFeedback={props.onSubmitFeedback}
        onExportTurn={props.onExportTurn}
      />
    );
  });

// Default model activation settings when no bot is selected
const defaultActiveModels: ActiveModels = (() => {
  return Object.fromEntries(
    AVAILABLE_MODEL_KEYS.map((key: Model) => [toCamelCase(key), true])
  ) as ActiveModels;
})();

const ChatPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { open: openSnackbar } = useSnackbar();
  const { errorDetail } = usePostMessageStreaming();
  const { isAdmin } = useLoginUser();
  const { pinBot, unpinBot } = useBotPinning();

  const {
    streamingState,
    conversationError,
    postingMessage,
    stopGeneration,
    canStop,
    stoppingMessage,
    newChat,
    postChat,
    messages,
    conversationId,
    setConversationId,
    hasError,
    retryPostChat,
    setCurrentMessageId,
    regenerate,
    continueGenerate,
    getPostedModel,
    loadingConversation,
    getShouldContinue,
    relatedDocuments,
    giveFeedback,
    reasoningEnabled,
    setReasoningEnabled,
    supportReasoning,
  } = useChat();

  // Error Handling
  useEffect(() => {
    if (conversationError) {
      if (conversationError.response?.status === 404) {
        openSnackbar(t('error.notFoundConversation'));
        newChat();
        navigate('/');
      } else {
        openSnackbar(conversationError.message ?? '');
      }
    }
  }, [conversationError, navigate, newChat, openSnackbar, t]);

  const { isWindows } = useIsWindows();

  const { getBotId } = useConversation();

  const { conversationId: paramConversationId, botId: paramBotId } =
    useParams();

  const {
    scrollToBottom,
    scrollToTop,
    viewportRef,
    contentRef,
    awayFromBottom,
    jumpToBottom,
  } = useScroll(paramConversationId ?? paramBotId ?? 'new');

  const botId = useMemo(() => {
    return paramBotId ?? getBotId(conversationId);
  }, [conversationId, getBotId, paramBotId]);

  const {
    data: bot,
    error: botError,
    isLoading: isLoadingBot,
    mutate: mutateBot,
  } = useBotSummary(botId ?? undefined);

  const [pageTitle, setPageTitle] = useState('');
  const [exportTarget, setExportTarget] = useState<{
    messages: DisplayMessageContent[];
    isTurn: boolean;
  }>();
  const [isAvailabilityBot, setIsAvailabilityBot] = useState(false);

  useEffect(() => {
    setIsAvailabilityBot(false);
    if (bot) {
      setIsAvailabilityBot(true);
      setPageTitle(bot.title);
    } else {
      setPageTitle(t('bot.label.normalChat'));
    }
    if (botError) {
      setPageTitle(t('bot.label.notAvailableBot'));

      // redirect to new chat(no bot chat) if not set conversationId
      if (!conversationId) {
        openSnackbar(t('error.cannotAccessBot'));
        newChat();
        navigate('/');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot, botError]);

  const description = useMemo<string>(() => {
    if (!bot) {
      return '';
    } else {
      return bot.description;
    }
  }, [bot]);

  const isLastAssistantMessageEmpty = useMemo(() => {
    if (messages.length === 0) {
      return false;
    }

    const lastMessage = messages[messages.length - 1];
    return lastMessage.role === 'assistant' && lastMessage.content.length === 0;
  }, [messages]);

  const disabledInput = useMemo(() => {
    return botId !== null && !isAvailabilityBot && !isLoadingBot;
  }, [botId, isAvailabilityBot, isLoadingBot]);

  useEffect(() => {
    setConversationId(paramConversationId ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramConversationId]);

  const inputBotParams = useMemo(() => {
    return botId
      ? {
          botId: botId,
          hasKnowledge: bot?.hasKnowledge ?? false,
          hasAgent: bot?.hasAgent ?? false,
        }
      : undefined;
  }, [bot?.hasKnowledge, botId, bot?.hasAgent]);

  const onSend = useCallback(
    (
      content: string,
      enableReasoning: boolean,
      base64EncodedImages?: string[],
      attachments?: AttachmentType[]
    ) => {
      jumpToBottom();
      postChat({
        content,
        base64EncodedImages,
        attachments,
        bot: inputBotParams,
        enableReasoning,
      });
    },
    [inputBotParams, postChat, jumpToBottom]
  );

  const onChangeCurrentMessageId = useCallback(
    (messageId: string) => {
      setCurrentMessageId(messageId);
    },
    [setCurrentMessageId]
  );

  const onSubmitEditedContent = useCallback(
    (messageId: string, content: string) => {
      if (hasError) {
        retryPostChat({
          content,
          bot: inputBotParams,
          enableReasoning: reasoningEnabled,
        });
      } else {
        regenerate({
          messageId,
          content,
          bot: inputBotParams,
          enableReasoning: reasoningEnabled,
        });
      }
    },
    [hasError, inputBotParams, regenerate, retryPostChat, reasoningEnabled]
  );

  const onRegenerate = useCallback(
    (enableReasoning: boolean) => {
      jumpToBottom();
      regenerate({
        bot: inputBotParams,
        enableReasoning,
      });
    },
    [inputBotParams, regenerate, jumpToBottom]
  );

  const onContinueGenerate = useCallback(() => {
    jumpToBottom();
    continueGenerate({ bot: inputBotParams });
  }, [inputBotParams, continueGenerate, jumpToBottom]);

  useLayoutEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    } else {
      scrollToTop();
    }
  }, [messages, scrollToBottom, scrollToTop]);

  const { updateStarred } = useBot();
  const onClickBotEdit = useCallback(
    (botId: string) => {
      navigate(`/bot/edit/${botId}`);
    },
    [navigate]
  );

  const onClickStar = useCallback(async () => {
    if (!bot) {
      return;
    }
    const isStarred = !bot.isStarred;
    mutateBot(
      produce(bot, (draft) => {
        draft.isStarred = isStarred;
      }),
      {
        revalidate: false,
      }
    );

    updateStarred(bot.id, isStarred).finally(() => {
      mutateBot();
    });
  }, [bot, mutateBot, updateStarred]);

  const onClickCopyUrl = useCallback((botId: string) => {
    copyBotUrl(botId);
  }, []);

  const onClickSyncError = useCallback(() => {
    navigate(`/bot/edit/${bot?.id}`);
  }, [bot?.id, navigate]);

  const { disabledImageUpload } = useModel();
  const [dndMode, setDndMode] = useState(false);
  const [suggestedPrompt, setSuggestedPrompt] = useState<{
    text: string;
    id: number;
  }>();
  const onDragOver: React.DragEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      if (!disabledImageUpload) {
        setDndMode(true);
      }
      e.preventDefault();
    },
    [disabledImageUpload]
  );

  const endDnd: React.DragEventHandler<HTMLDivElement> = useCallback((e) => {
    setDndMode(false);
    e.preventDefault();
  }, []);

  const focusInputRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isNewConversationCommand = (() => {
        if (event.code !== 'KeyO') {
          return false;
        }
        if (isWindows) {
          return event.ctrlKey && event.shiftKey;
        } else {
          return event.metaKey && event.shiftKey;
        }
      })();
      const isFocusChatInputCommand = event.code === 'Escape' && event.shiftKey;

      if (isNewConversationCommand) {
        event.preventDefault();
        newChat();

        if (botId) {
          navigate(`/bot/${botId}`);
        } else {
          navigate('/');
        }
      } else if (isFocusChatInputCommand) {
        focusInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  const activeModels = useMemo(() => {
    if (!bot) {
      return defaultActiveModels;
    }
    const isActiveModelsEmpty =
      Object.keys(bot?.activeModels ?? {}).length === 0;
    return isActiveModelsEmpty ? defaultActiveModels : bot.activeModels;
  }, [bot]);

  const togglePinBot = useCallback(
    (bot: BotSummary) => {
      mutateBot(
        produce(bot, (draft) => {
          draft.sharedStatus = isPinnedBot(bot.sharedStatus)
            ? 'shared'
            : 'pinned@000';
        }),
        {
          revalidate: false,
        }
      );

      if (isPinnedBot(bot.sharedStatus)) {
        unpinBot(bot.id).finally(() => {
          mutateBot();
        });
      } else {
        pinBot(bot.id, 0).finally(() => {
          mutateBot();
        });
      }
    },
    [mutateBot, pinBot, unpinBot]
  );

  const canSwitchPinned = useMemo(() => {
    return isAdmin && canBePinned(bot?.sharedScope ?? 'private');
  }, [bot?.sharedScope, isAdmin]);

  return (
    <div
      className="workspace-chat relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      onDragOver={onDragOver}
      onDrop={endDnd}
      onDragEnd={endDnd}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="workspace-chat-header relative z-10 flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-gray/15 px-3 py-2 sm:min-h-16 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center justify-between">
            <div className="min-w-0 flex-1 p-2">
              <div className="flex min-w-0 items-center font-bold">
                {isLoadingBot ? (
                  <Skeleton className="h-5 w-32" />
                ) : (
                  <>
                    <IconPinnedBot
                      botSharedStatus={bot?.sharedStatus}
                      className="mr-1 text-aws-aqua"
                    />
                    <span className="truncate">
                      {bot ? pageTitle : 'BatteryPool AI'}
                    </span>
                  </>
                )}
              </div>
            </div>

            {isLoadingBot && (
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="size-7" />
                <Skeleton className="h-7 w-12" />
              </div>
            )}

            {isAvailabilityBot && !isLoadingBot && (
              <div className="flex shrink-0 items-center">
                <div className="flex items-center bg-aws-paper-light dark:bg-aws-paper-dark">
                  {bot?.owned && (
                    <StatusSyncBot
                      syncStatus={bot.syncStatus}
                      onClickError={onClickSyncError}
                    />
                  )}

                  <ButtonStar
                    isStarred={bot?.isStarred ?? false}
                    onClick={onClickStar}
                  />

                  <MenuBot
                    className="mx-1"
                    {...(bot?.owned && {
                      onClickEdit: () => {
                        onClickBotEdit(bot.id);
                      },
                    })}
                    {...(bot?.sharedScope !== 'private' && {
                      onClickCopyUrl: () => {
                        onClickCopyUrl(bot?.id ?? '');
                      },
                    })}
                    {...(canSwitchPinned
                      ? {
                          onClickSwitchPinned: () => {
                            if (bot) {
                              togglePinBot(bot);
                            }
                          },
                          isPinned: isPinnedBot(bot?.sharedStatus ?? ''),
                        }
                      : {
                          isPinned: undefined,
                          onClickSwitchPinned: undefined,
                        })}
                  />
                </div>
              </div>
            )}
          </div>
          {getPostedModel() && (
            <div className="workspace-model-label ml-3 shrink-0 rounded-full bg-aws-sea-blue-light/5 px-3 py-1 text-xs text-dark-gray dark:text-light-gray">
              {getPostedModel()
                ?.replace('claude-v', 'Claude ')
                .replace(/-/g, ' ')}
            </div>
          )}
          {messages.length > 0 && (
            <button
              type="button"
              aria-label="Export full conversation"
              title="Copy or download the full conversation"
              disabled={postingMessage}
              className="ml-2 flex shrink-0 items-center gap-2 rounded-lg border border-gray/20 p-2 text-sm disabled:opacity-40"
              onClick={() =>
                setExportTarget({
                  messages: structuredClone(messages),
                  isTurn: false,
                })
              }>
              <PiExport aria-hidden="true" />
              <span className="hidden sm:inline">Export</span>
            </button>
          )}
        </div>
        <section className="relative min-h-0 flex-1">
          <div
            id="messages"
            ref={viewportRef}
            role="region"
            aria-label="Conversation"
            tabIndex={0}
            className="workspace-messages h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain">
            <div ref={contentRef} className="flex min-h-full flex-col pb-4">
              {messages?.length === 0 ? (
                <div className="workspace-welcome-container m-auto flex w-full max-w-4xl shrink-0 flex-col items-center px-5 py-6 sm:py-8">
                  {!loadingConversation && (
                    <>
                      <ChatWelcome
                        title={bot ? pageTitle : undefined}
                        description={description}
                        onChoosePrompt={(text) => {
                          setSuggestedPrompt({ text, id: Date.now() });
                          focusInputRef.current?.focus();
                        }}
                      />
                      <SwitchBedrockModel
                        className="mt-6"
                        activeModels={activeModels}
                        botId={botId}
                      />
                    </>
                  )}
                  {loadingConversation && (
                    <Skeleton className="h-32 w-full max-w-lg" />
                  )}
                </div>
              ) : (
                <>
                  {messages?.map((message, idx, array) => (
                    <div
                      key={message.id}
                      className={`shrink-0 ${
                        message.role === 'assistant'
                          ? 'workspace-assistant-turn'
                          : ''
                      }`}>
                      <ChatMessageWithRelatedDocuments
                        chatContent={message}
                        isStreaming={postingMessage && idx + 1 === array.length}
                        streamingReasoning={streamingState.context.reasoning}
                        streamingTools={streamingState.context.tools}
                        streamingRelatedDocuments={
                          streamingState.context.relatedDocuments
                        }
                        streamingStateValue={streamingState.value as string}
                        botHasAgent={bot?.hasAgent ?? false}
                        botHasKnowledge={bot?.hasKnowledge ?? false}
                        relatedDocuments={relatedDocuments ?? []}
                        onChangeMessageId={onChangeCurrentMessageId}
                        onSubmit={onSubmitEditedContent}
                        onExportTurn={() => {
                          const userMessage = array
                            .slice(0, idx)
                            .reverse()
                            .find((m) => m.role === 'user');
                          setExportTarget({
                            messages: structuredClone(
                              userMessage ? [userMessage, message] : [message]
                            ),
                            isTurn: true,
                          });
                        }}
                        onSubmitFeedback={(messageId, feedback) => {
                          if (conversationId) {
                            giveFeedback(messageId, feedback);
                          }
                        }}
                      />
                    </div>
                  ))}
                </>
              )}
              {hasError && (
                <div className="mt-2 mb-12 flex flex-col items-center">
                  <div className="flex items-center font-bold text-red">
                    <PiWarningCircleFill className="mr-1 text-2xl" />
                    {errorDetail ?? t('error.answerResponse')}
                  </div>

                  <Button
                    className="mt-2 shadow-sm"
                    icon={<PiArrowsCounterClockwise />}
                    outlined
                    onClick={() => {
                      retryPostChat({
                        enableReasoning: reasoningEnabled,
                        bot: inputBotParams,
                      });
                    }}>
                    {t('button.resend')}
                  </Button>
                </div>
              )}
            </div>
          </div>
          {awayFromBottom && messages.length > 0 && (
            <button
              type="button"
              className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-gray/30 bg-white px-4 py-2 text-sm shadow-md dark:bg-aws-ui-color-dark"
              onClick={() => {
                jumpToBottom();
                viewportRef.current?.focus({ preventScroll: true });
              }}>
              <PiArrowDown aria-hidden="true" />
              Jump to latest
            </button>
          )}
        </section>
      </div>

      <div
        className={twMerge(
          'workspace-composer-area z-10 flex max-h-[60dvh] shrink-0 flex-col items-center overflow-y-auto px-3 pt-2 pb-3 sm:px-6 sm:pb-4'
        )}>
        {bot && bot.syncStatus !== SyncStatus.SUCCEEDED && (
          <div className="mb-8 w-1/2">
            <Alert
              severity="warning"
              title={t('bot.alert.sync.incomplete.title')}>
              {t('bot.alert.sync.incomplete.body')}
            </Alert>
          </div>
        )}
        {messages.length === 0 && (
          <div className="mb-3 flex w-full max-w-4xl flex-wrap gap-2">
            {bot?.conversationQuickStarters?.map((qs, idx) => (
              <button
                key={idx}
                type="button"
                className="min-w-0 flex-1 rounded-xl border border-gray/20 bg-white p-2 text-left text-sm text-dark-gray hover:bg-aws-sea-blue-light/5 dark:bg-aws-ui-color-dark dark:text-light-gray"
                onClick={() => {
                  onSend(qs.example, reasoningEnabled);
                }}>
                <div>
                  <PiPenNib />
                </div>
                {qs.title}
              </button>
            ))}
          </div>
        )}

        <InputChatContent
          className="w-full max-w-4xl"
          suggestedPrompt={suggestedPrompt}
          dndMode={dndMode}
          disabledSend={
            postingMessage || hasError || isLastAssistantMessageEmpty
          }
          disabledRegenerate={postingMessage || hasError}
          disabledContinue={postingMessage || hasError}
          disabled={disabledInput}
          placeholder={
            disabledInput
              ? t('bot.label.notAvailableBotInputMessage')
              : undefined
          }
          canRegenerate={messages.length > 1}
          canContinue={getShouldContinue()}
          isLoading={postingMessage}
          onStop={canStop ? stopGeneration : undefined}
          stopping={stoppingMessage}
          isNewChat={messages.length == 0}
          onSend={onSend}
          onRegenerate={onRegenerate}
          continueGenerate={onContinueGenerate}
          ref={focusInputRef}
          supportReasoning={supportReasoning}
          reasoningEnabled={reasoningEnabled}
          onChangeReasoning={setReasoningEnabled}
        />
      </div>
      <BottomHelper />
      {exportTarget && (
        <ConversationExportDialog
          isOpen
          messages={exportTarget.messages}
          isTurn={exportTarget.isTurn}
          onClose={() => setExportTarget(undefined)}
        />
      )}
    </div>
  );
};

export default ChatPage;
