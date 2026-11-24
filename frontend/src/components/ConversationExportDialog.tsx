import { useEffect, useMemo, useRef, useState } from 'react';
import { DisplayMessageContent } from '../@types/conversation';
import ModalDialog from './ModalDialog';
import Button from './Button';
import useHttp from '../hooks/useHttp';
import {
  AttachmentText,
  buildConversationExport,
  ConversationExport,
  serializeConversationExport,
} from '../utils/conversationExport';
import { copyText, downloadText } from '../utils/copyText';

type Props = {
  isOpen: boolean;
  messages: DisplayMessageContent[];
  isTurn?: boolean;
  onClose: () => void;
};
export default function ConversationExportDialog({
  isOpen,
  messages,
  isTurn,
  onClose,
}: Props) {
  const http = useHttp();
  const loader = useRef(http.getOnce);
  loader.current = http.getOnce;
  const [format, setFormat] = useState<'markdown' | 'text' | 'json'>(
    'markdown'
  );
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [includeCitations, setIncludeCitations] = useState(true);
  const [prepared, setPrepared] = useState<{
    input: DisplayMessageContent[];
    attachments: boolean;
    citations: boolean;
    data: ConversationExport;
  }>();
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [copying, setCopying] = useState(false);
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const abort = new AbortController();
    setError('');
    setCopyStatus('');
    buildConversationExport(
      messages,
      { includeAttachments, includeCitations },
      async (id) => {
        const result = await loader.current<
          Omit<AttachmentText, 'text'> & { textBase64: string | null }
        >(`attachments/${id}/text`, undefined, undefined, abort.signal);
        return {
          ...result.data,
          text:
            result.data.textBase64 === null
              ? null
              : new TextDecoder('utf-8', { fatal: true }).decode(
                  Uint8Array.from(atob(result.data.textBase64), (c) =>
                    c.charCodeAt(0)
                  )
                ),
        };
      }
    )
      .then((data) => {
        if (!abort.signal.aborted) {
          setPrepared({
            input: messages,
            attachments: includeAttachments,
            citations: includeCitations,
            data,
          });
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setError(
            'Could not prepare this export. Close the dialog and try again.'
          );
        }
      });
    return () => abort.abort();
  }, [isOpen, messages, includeAttachments, includeCitations]);
  const ready =
    prepared?.input === messages &&
    prepared.attachments === includeAttachments &&
    prepared.citations === includeCitations;
  const data = ready ? prepared.data : undefined;
  const text = useMemo(
    () => (data ? serializeConversationExport(data, format) : ''),
    [data, format]
  );
  const missing =
    data?.files.filter((file) => file.text === undefined).length || 0;
  return (
    <ModalDialog
      isOpen={isOpen}
      title={isTurn ? 'Copy request and response' : 'Export conversation'}
      showCloseIcon
      onClose={onClose}>
      <p className="mb-3 text-sm">
        Take these prompts, answers and available file text to another LLM. This
        exports the selected replies. Images and original binary documents may
        need to be reattached; hidden instructions and internal reasoning are
        excluded.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Format
          <select
            aria-label="Export format"
            value={format}
            onChange={(event) => setFormat(event.target.value as typeof format)}
            className="rounded-lg border border-gray/30 bg-white p-2 dark:bg-aws-ui-color-dark">
            <option value="markdown">Markdown (.md)</option>
            <option value="text">Plain text (.txt)</option>
            <option value="json">JSON (.json)</option>
          </select>
        </label>
      </div>
      <div className="my-3 flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeAttachments}
            onChange={(event) => setIncludeAttachments(event.target.checked)}
          />
          Include full extracted attachment text
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeCitations}
            onChange={(event) => setIncludeCitations(event.target.checked)}
          />
          Include available cited source excerpts
        </label>
      </div>
      {!data && !error && <p role="status">Preparing the conversation…</p>}
      {error && (
        <p role="alert" className="text-red">
          {error}
        </p>
      )}
      {data && (
        <>
          <p className="mb-2 text-xs">
            {data.messages.length} messages · {text.length.toLocaleString()}{' '}
            characters. The destination LLM’s context limits still apply.
          </p>
          {missing > 0 && (
            <p role="status" className="mb-2 text-xs">
              {missing} file(s) need attention or reattachment. The export lists
              the details.
            </p>
          )}
          <textarea
            aria-label="Export preview"
            readOnly
            value={text.slice(0, 20000)}
            className="max-h-[30dvh] min-h-32 w-full resize-y overflow-auto rounded-lg border border-gray/30 bg-white p-2 font-mono text-xs dark:bg-aws-ui-color-dark"
          />
          {text.length > 20000 && (
            <p className="mt-1 text-xs">
              Preview shows the first 20,000 characters. Copy and Download
              include the entire export.
            </p>
          )}
        </>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          outlined
          disabled={!data}
          onClick={() => {
            const extension =
              format === 'markdown' ? 'md' : format === 'text' ? 'txt' : 'json';
            downloadText(
              text,
              `batterypool-${isTurn ? 'request-response' : 'conversation'}.${extension}`,
              format === 'json'
                ? 'application/json'
                : format === 'markdown'
                  ? 'text/markdown'
                  : 'text/plain'
            );
          }}>
          Download
        </Button>
        <Button
          disabled={!data || copying}
          onClick={async () => {
            setCopying(true);
            try {
              await copyText(text);
              setCopyStatus('Copied the entire export.');
            } catch {
              setCopyStatus(
                'Copy failed. Use Download to get the entire export.'
              );
            } finally {
              setCopying(false);
            }
          }}>
          {copying ? 'Copying…' : 'Copy all'}
        </Button>
      </div>
      <p role="status" className="mt-2 text-sm">
        {copyStatus}
      </p>
    </ModalDialog>
  );
}
