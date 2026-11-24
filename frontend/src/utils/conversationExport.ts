import { DisplayMessageContent } from '../@types/conversation';
import { TEXT_FILE_EXTENSIONS } from '../constants/supportedAttachedFiles';

export type AttachmentText = {
  filename: string;
  kind: string;
  characters: number;
  notice?: string;
  text: string | null;
};
export type ExportOptions = {
  includeAttachments: boolean;
  includeCitations: boolean;
};
export type ConversationExport = {
  version: 1;
  source: 'BatteryPool AI';
  scope: 'selected_conversation_path';
  messages: {
    role: 'user' | 'assistant';
    model: string;
    text: string;
    stopped: boolean;
    files: string[];
  }[];
  files: {
    id: string;
    name: string;
    kind: string;
    text?: string;
    notice?: string;
  }[];
  citedContext: { source: string; text: string }[];
  notes: string[];
};

export function messageText(
  message: Pick<DisplayMessageContent, 'content'>
): string {
  return message.content
    .flatMap((c) => (c.contentType === 'text' ? [c.body] : []))
    .join('\n\n');
}

export async function buildConversationExport(
  messages: DisplayMessageContent[],
  options: ExportOptions,
  loadAttachment: (id: string) => Promise<AttachmentText>
): Promise<ConversationExport> {
  const output: ConversationExport = {
    version: 1,
    source: 'BatteryPool AI',
    scope: 'selected_conversation_path',
    messages: [],
    files: [],
    citedContext: [],
    notes: [
      'This contains the selected conversation replies, not an exact provider request. Hidden instructions and internal reasoning are not included.',
    ],
  };
  const references = new Map<string, string>();
  const pending: {
    file: ConversationExport['files'][number];
    uploadId: string;
  }[] = [];
  const sources = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') {
      continue;
    }
    const exported = {
      role: message.role,
      model: message.model,
      text: messageText(message),
      stopped: Boolean(message.stopped),
      files: [] as string[],
    };
    for (const [index, content] of message.content.entries()) {
      if (
        content.contentType !== 'image' &&
        content.contentType !== 'attachment'
      ) {
        continue;
      }
      const key =
        content.contentType === 'attachment' && content.objectKey
          ? content.objectKey
          : `${message.id}:${index}`;
      const existing = references.get(key);
      if (existing) {
        exported.files.push(existing);
        continue;
      }
      const file: ConversationExport['files'][number] = {
        id: `file-${output.files.length + 1}`,
        name:
          content.contentType === 'image'
            ? `Image ${index + 1}`
            : content.fileName || 'Attachment',
        kind: content.contentType,
      };
      references.set(key, file.id);
      exported.files.push(file.id);
      output.files.push(file);
      if (content.contentType === 'image') {
        file.notice =
          'Image bytes are not included. Reattach the original image in the destination LLM.';
      } else if (!options.includeAttachments) {
        file.notice = 'Attachment text was excluded from this export.';
      } else if (content.objectKey) {
        const match =
          /^chat-attachments\/[^/]+\/([a-f0-9]{32})\/manifest\.json$/.exec(
            content.objectKey
          );
        if (match) {
          pending.push({ file, uploadId: match[1] });
        } else {
          file.kind = 'unavailable';
          file.notice = 'This attachment reference could not be exported.';
        }
      } else if (
        TEXT_FILE_EXTENSIONS.some((ext) =>
          file.name.toLowerCase().endsWith(ext.toLowerCase())
        )
      ) {
        try {
          file.text = new TextDecoder('utf-8', { fatal: true }).decode(
            Uint8Array.from(atob(content.body), (c) => c.charCodeAt(0))
          );
          file.kind = 'text';
        } catch {
          file.kind = 'unavailable';
          file.notice = 'The legacy attachment could not be decoded.';
        }
      } else {
        file.kind = 'document';
        file.notice =
          'Original binary document is not included. Reattach it in the destination LLM.';
      }
    }
    output.messages.push(exported);
    if (options.includeCitations) {
      for (const chunk of message.usedChunks || []) {
        const key = `${chunk.source}\n${chunk.content}`;
        if (sources.has(key)) {
          continue;
        }
        sources.add(key);
        // Export source labels without signed URL query strings or credentials.
        let source = chunk.source;
        try {
          const url = new URL(source);
          source =
            url.protocol === 'https:' || url.protocol === 'http:'
              ? `${url.origin}${url.pathname}`
              : url.pathname.split('/').pop() || 'Knowledge source';
        } catch {
          source = source.split('?')[0].split('#')[0];
        }
        output.citedContext.push({ source, text: chunk.content });
      }
    }
  }
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (cursor < pending.length) {
        const { file, uploadId } = pending[cursor++];
        try {
          const attachment = await loadAttachment(uploadId);
          file.name = attachment.filename;
          file.kind = attachment.kind;
          file.notice = attachment.notice;
          if (attachment.text !== null) {
            file.text = attachment.text;
          } else {
            file.notice =
              `${attachment.notice || ''} Original binary document is not included. Reattach it in the destination LLM.`.trim();
          }
        } catch (error) {
          if (
            error instanceof Error &&
            (error.name === 'AbortError' || error.name === 'CanceledError')
          ) {
            throw error;
          }
          file.kind = 'unavailable';
          file.notice =
            'Attachment text could not be loaded. Reattach the original file in the destination LLM.';
        }
      }
    })
  );
  const missing = output.files.filter((file) => file.text === undefined);
  if (missing.length) {
    output.notes.push(
      `${missing.length} file(s) have no content in this export. See the file notes and reattach originals where needed.`
    );
  }
  if (output.messages.some((m) => m.stopped)) {
    output.notes.push('Stopped responses are partial and may be incomplete.');
  }
  return output;
}

export function serializeConversationExport(
  data: ConversationExport,
  format: 'markdown' | 'text' | 'json'
): string {
  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }
  const markdown = format === 'markdown';
  const heading = (text: string, depth = 2) =>
    markdown ? `${'#'.repeat(depth)} ${text}` : text.toUpperCase();
  const sections = [
    heading('Conversation from BatteryPool AI', 1),
    data.notes.map((note) => `- ${note}`).join('\n'),
  ];
  for (const [index, message] of data.messages.entries()) {
    sections.push(
      heading(
        `${index + 1}. ${message.role === 'user' ? 'User' : 'Assistant'}${message.stopped ? ' — stopped' : ''}`
      ),
      `Model: ${message.model}`,
      message.text
    );
    if (message.files.length) {
      sections.push(
        `Files: ${message.files.join(', ')} (see attached context below)`
      );
    }
  }
  if (data.files.length) {
    sections.push(heading('Attached context'));
  }
  for (const file of data.files) {
    sections.push(heading(`${file.id}: ${file.name}`, 3));
    if (file.notice) {
      sections.push(`Note: ${file.notice}`);
    }
    if (file.text !== undefined) {
      sections.push(file.text);
    }
  }
  if (data.citedContext.length) {
    sections.push(heading('Cited source excerpts'));
  }
  for (const chunk of data.citedContext) {
    sections.push(heading(chunk.source, 3), chunk.text);
  }
  return sections.join('\n\n');
}
