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

const usePostMessageStreaming = create<{
  post: (params: {
    input: PostMessageRequest;
    hasKnowledge?: boolean;
    handleStreamingEvent: (event: StreamingEvent) => void;
  }) => Promise<void>;
  errorDetail: string | null;
}>((set) => {
  return {
    errorDetail: null,
    post: async ({ input, handleStreamingEvent }) => {
      set({ errorDetail: null });
      handleStreamingEvent({ type: 'wakeup' });

      const token = (await fetchAuthSession()).tokens?.idToken?.toString();
      if (!token) {
        const detail = 'Your session has expired. Sign in again to continue.';
        set({errorDetail: detail});
        throw new Error(detail);
      }
      const payloadString = JSON.stringify({
        ...input,
        token,
      });

      const chunkedPayloads = makeStreamFrames(payloadString, PostStreamingStatus.BODY);

      let receivedCount = 0;
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(WS_ENDPOINT);
        let settled = false;
        let idleTimer: ReturnType<typeof setTimeout>;
        const totalTimer = setTimeout(() => fail('This response exceeded the time limit. Please try a smaller request.'), 15 * 60 * 1000);
        const clearTimers = () => { clearTimeout(idleTimer); clearTimeout(totalTimer); };
        const fail = (detail: string) => {
          if (settled) {return;}
          settled = true;
          clearTimers();
          set({ errorDetail: detail });
          reject(new Error(detail));
          ws.close();
        };
        const resetIdle = (timeout = IDLE_TIMEOUT_MS) => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => fail('The response connection timed out. Retry when your connection is stable.'), timeout);
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
            if (settled) {return;}
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
                  Object.entries(data.log).forEach(([toolUseId, toolInfo]) => {
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
                  });
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
                case PostStreamingStatus.STREAMING_END:
                  handleStreamingEvent({type: 'goodbye'});
                  settled = true;
                  clearTimers();
                  resolve();
                  ws.close();
                  break;
                case PostStreamingStatus.ERROR:
                  fail(data.reason || i18next.t('error.predict.invalidResponse'));
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
        ws.onerror = () => fail('Could not connect to the response service. Check your connection and retry.');
        ws.onclose = () => {
          if (!settled) {fail('The connection ended before the response completed. Retry to generate a complete answer.');}
        };
      });
    },
  };
});

export default usePostMessageStreaming;
