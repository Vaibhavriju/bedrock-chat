import { fetchAuthSession } from 'aws-amplify/auth';
import { PostMessageRequest } from '../@types/conversation';
import { create } from 'zustand';
import i18next from 'i18next';
import { StreamingEvent } from './xstates/streaming';
import { PostStreamingStatus } from '../constants';
import { makeStreamFrames } from '../utils/streamFrames';

const WS_ENDPOINT: string = import.meta.env.VITE_APP_WS_ENDPOINT;
const CONNECT_TIMEOUT_MS = 15000;
const IDLE_TIMEOUT_MS = 120000;

export type StreamResult = { cancelled: boolean; persisted: boolean };

const usePostMessageStreaming = create<{
  post: (params: {
    input: PostMessageRequest;
    hasKnowledge?: boolean;
    handleStreamingEvent: (event: StreamingEvent) => void;
  }) => Promise<StreamResult>;
  errorDetail: string | null;
  isActive: boolean;
  isStopping: boolean;
  stop: () => void;
}>((set) => {
  let stopActive: (() => void) | undefined;
  return {
    errorDetail: null,
    isActive: false,
    isStopping: false,
    stop: () => stopActive?.(),
    post: async ({ input, handleStreamingEvent }) => {
      if (stopActive) {
        throw new Error(
          'Another response is still running. Stop it or wait for it to finish.'
        );
      }
      let requestedStop = false;
      let stopSocket: (() => void) | undefined;
      stopActive = () => {
        if (requestedStop) {
          return;
        }
        requestedStop = true;
        set({ isStopping: true });
        stopSocket?.();
      };
      set({ errorDetail: null, isActive: true, isStopping: false });
      handleStreamingEvent({ type: 'wakeup' });
      try {
        const token = (await fetchAuthSession()).tokens?.idToken?.toString();
        if (requestedStop) {
          handleStreamingEvent({ type: 'goodbye' });
          return { cancelled: true, persisted: false };
        }
        if (!token) {
          const detail = 'Your session has expired. Sign in again to continue.';
          set({ errorDetail: detail });
          throw new Error(detail);
        }
        // Authentication belongs in control frames, not persisted message chunks.
        const payloadString = JSON.stringify(input);

        const chunkedPayloads = makeStreamFrames(
          payloadString,
          PostStreamingStatus.BODY
        );

        let receivedCount = 0;
        return await new Promise<StreamResult>((resolve, reject) => {
          const ws = new WebSocket(WS_ENDPOINT);
          let settled = false;
          let sentToBackend = false;
          let idleTimer: ReturnType<typeof setTimeout>;
          const totalTimer = setTimeout(
            () =>
              fail(
                'This response exceeded the time limit. Please try a smaller request.'
              ),
            15 * 60 * 1000
          );
          const clearTimers = () => {
            clearTimeout(idleTimer);
            clearTimeout(totalTimer);
          };
          const fail = (detail: string) => {
            if (settled) {
              return;
            }
            settled = true;
            clearTimers();
            const message = requestedStop
              ? 'Could not confirm that generation stopped. Refresh this conversation before sending another request.'
              : detail;
            set({ errorDetail: message });
            reject(new Error(message));
            ws.close();
          };
          const resetIdle = (timeout = IDLE_TIMEOUT_MS) => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(
              () =>
                fail(
                  'The response connection timed out. Retry when your connection is stable.'
                ),
              timeout
            );
          };
          const finish = (result: StreamResult) => {
            if (settled) {
              return;
            }
            settled = true;
            clearTimers();
            handleStreamingEvent({ type: 'goodbye' });
            set({ errorDetail: null });
            resolve(result);
            ws.close();
          };
          stopSocket = () => {
            if (settled) {
              return;
            }
            if (!sentToBackend) {
              finish({ cancelled: true, persisted: false });
              return;
            }
            try {
              ws.send(JSON.stringify({ step: 'CANCEL', token }));
            } catch {
              fail('The stop request could not be sent.');
            }
          };
          resetIdle(CONNECT_TIMEOUT_MS);

          ws.onopen = () => {
            resetIdle();
            ws.send(
              JSON.stringify({
                step: PostStreamingStatus.START,
                token: token,
              })
            );
          };

          ws.onmessage = (message) => {
            try {
              if (settled) {
                return;
              }
              resetIdle();
              if (
                message.data === '' ||
                message.data === 'Message sent.' ||
                // Ignore timeout message from api gateway
                message.data.startsWith(
                  '{"message": "Endpoint request timed out",'
                )
              ) {
                return;
              } else if (message.data === 'Session started.') {
                chunkedPayloads.forEach((frame) => ws.send(frame));
                return;
              } else if (message.data === 'Message part received.') {
                receivedCount++;
                if (receivedCount === chunkedPayloads.length) {
                  sentToBackend = true;
                  ws.send(
                    JSON.stringify({
                      step: PostStreamingStatus.END,
                      token: token,
                    })
                  );
                }
                return;
              }

              const data = JSON.parse(message.data);

              if (data.status) {
                switch (data.status) {
                  case PostStreamingStatus.AGENT_THINKING: {
                    Object.entries(data.log).forEach(
                      ([toolUseId, toolInfo]) => {
                        const typedToolInfo = toolInfo as {
                          name: string;
                          input: { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
                        };
                        handleStreamingEvent({
                          type: 'tool-use',
                          toolUseId: toolUseId,
                          name: typedToolInfo.name,
                          input: typedToolInfo.input,
                        });
                      }
                    );
                    break;
                  }
                  case PostStreamingStatus.AGENT_TOOL_RESULT:
                    handleStreamingEvent({
                      type: 'tool-result',
                      toolUseId: data.result.toolUseId,
                      status: data.result.status,
                    });
                    break;
                  case PostStreamingStatus.AGENT_RELATED_DOCUMENT:
                    handleStreamingEvent({
                      type: 'related-document',
                      toolUseId: data.result.toolUseId,
                      relatedDocument: data.result.relatedDocument,
                    });
                    break;
                  case PostStreamingStatus.REASONING:
                    handleStreamingEvent({
                      type: 'reasoning',
                      reasoning: data.completion,
                    });
                    break;
                  case PostStreamingStatus.STREAMING:
                    handleStreamingEvent({
                      type: 'text',
                      text: data.completion,
                    });
                    break;
                  case 'HEARTBEAT':
                    // Keep reasoning/tool waits alive without changing partial text.
                    break;
                  case 'STOP_REQUESTED':
                    set({ isStopping: true });
                    break;
                  case 'STOP_REJECTED':
                    // Natural completion may already be queued; wait for its
                    // authoritative end event instead of labelling it cancelled.
                    set({
                      errorDetail:
                        data.reason || 'Waiting for the response to finish.',
                    });
                    break;
                  case PostStreamingStatus.STREAMING_END:
                    finish({
                      cancelled: data.stop_reason === 'cancelled',
                      persisted: true,
                    });
                    break;
                  case PostStreamingStatus.ERROR:
                    fail(
                      data.reason || i18next.t('error.predict.invalidResponse')
                    );
                    break;
                  default:
                    handleStreamingEvent({
                      type: 'reset',
                    });
                    break;
                }
              } else {
                throw new Error(i18next.t('error.predict.invalidResponse'));
              }
            } catch {
              fail(i18next.t('error.predict.general'));
            }
          };
          ws.onerror = () =>
            fail(
              'Could not connect to the response service. Check your connection and retry.'
            );
          ws.onclose = () => {
            if (!settled) {
              fail(
                'The connection ended before the response completed. Retry to generate a complete answer.'
              );
            }
          };
        });
      } catch (error) {
        handleStreamingEvent({ type: 'goodbye' });
        throw error;
      } finally {
        stopActive = undefined;
        set({ isActive: false, isStopping: false });
      }
    },
  };
});

export default usePostMessageStreaming;
