import { describe, expect, it, vi } from 'vitest';
import { DisplayMessageContent } from '../../@types/conversation';
import {
  buildConversationExport,
  serializeConversationExport,
} from '../conversationExport';

const message = (
  id: string,
  role: 'user' | 'assistant' | 'system',
  content: DisplayMessageContent['content']
): DisplayMessageContent => ({
  id,
  role,
  model: 'claude-v4.6-sonnet',
  content,
  parent: null,
  children: [],
  sibling: [id],
  feedback: null,
  usedChunks: null,
  thinkingLog: null,
});
const key = `chat-attachments/synthetic-owner/${'a'.repeat(32)}/manifest.json`;
const file = {
  contentType: 'attachment' as const,
  fileName: 'code.ts',
  body: '',
  objectKey: key,
};
const options = { includeAttachments: true, includeCitations: true };

describe('portable conversation export', () => {
  it('preserves every visible text block, code, citations and Unicode in order', async () => {
    const messages = [
      message('u', 'user', [{ contentType: 'text', body: 'नमस्ते 😀' }]),
      message('a', 'assistant', [
        { contentType: 'text', body: '```ts\nconst x = "[^keep]";\n```' },
        { contentType: 'text', body: 'Second block[^source]' },
      ]),
    ];
    const data = await buildConversationExport(messages, options, vi.fn());
    const markdown = serializeConversationExport(data, 'markdown');
    expect(markdown.indexOf('नमस्ते')).toBeLessThan(
      markdown.indexOf('const x')
    );
    expect(markdown).toContain('Second block[^source]');
    expect(markdown).toContain('"[^keep]"');
    expect(serializeConversationExport(data, 'text')).toContain(
      'Second block[^source]'
    );
    expect(
      JSON.parse(serializeConversationExport(data, 'json')).messages[1].text
    ).toContain('Second block');
  });
  it('loads complete extracted files once even when reused and never applies the preview limit', async () => {
    const text = 'A'.repeat(25000) + 'END-OF-FULL-FILE';
    const load = vi.fn(async () => ({
      filename: 'code.ts',
      kind: 'text',
      characters: text.length,
      text,
    }));
    const data = await buildConversationExport(
      [message('u', 'user', [file]), message('v', 'user', [file])],
      options,
      load
    );
    expect(load).toHaveBeenCalledOnce();
    expect(data.files).toHaveLength(1);
    expect(data.messages[1].files).toEqual(['file-1']);
    expect(serializeConversationExport(data, 'markdown')).toContain(
      'END-OF-FULL-FILE'
    );
    expect(serializeConversationExport(data, 'json')).not.toContain(
      'chat-attachments/'
    );
  });
  it('omits hidden/system content, reasoning signatures, raw image bytes and unrelated state', async () => {
    const secret = 'SYNTHETIC-INTERNAL-DO-NOT-EXPORT';
    const messages = [
      message('s', 'system', [{ contentType: 'text', body: secret }]),
      {
        ...message('a', 'assistant', [
          { contentType: 'text', body: 'Visible answer' },
          {
            contentType: 'reasoning',
            text: secret,
            signature: secret,
            redactedContent: secret,
          },
          { contentType: 'image', mediaType: 'image/png', body: secret },
        ]),
        authorization: secret,
      },
    ];
    const data = await buildConversationExport(messages, options, vi.fn());
    expect(JSON.stringify(data)).not.toContain(secret);
    expect(data.messages).toHaveLength(1);
    expect(data.files[0].notice).toContain('Reattach');
  });
  it('reports binary documents and failed attachment reads explicitly', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({
        filename: 'original.pdf',
        kind: 'document',
        characters: 0,
        text: null,
      })
      .mockRejectedValueOnce(new Error('private backend details'));
    const data = await buildConversationExport(
      [
        message('u', 'user', [
          file,
          { ...file, objectKey: key.replace('a'.repeat(32), 'b'.repeat(32)) },
        ]),
      ],
      options,
      load
    );
    expect(data.files[0].notice).toContain('Reattach');
    expect(data.files[1].kind).toBe('unavailable');
    expect(JSON.stringify(data)).not.toContain('private backend details');
    expect(data.notes.join(' ')).toContain('2 file(s)');
  });
  it('does not fetch excluded attachment text or expose signed source URL credentials', async () => {
    const m = message('u', 'user', [file]);
    m.usedChunks = [
      {
        source: 'https://example.com/document?X-Amz-Signature=SECRET',
        content: 'Relevant excerpt',
        contentType: 'url',
        rank: 1,
      },
    ];
    const load = vi.fn();
    const data = await buildConversationExport(
      [m],
      { includeAttachments: false, includeCitations: true },
      load
    );
    expect(load).not.toHaveBeenCalled();
    expect(data.citedContext[0].source).toBe('https://example.com/document');
    expect(JSON.stringify(data)).not.toContain('SECRET');
    const excluded = await buildConversationExport(
      [m],
      { includeAttachments: false, includeCitations: false },
      load
    );
    expect(excluded.citedContext).toEqual([]);
  });
  it('marks stopped replies as partial and decodes legacy UTF-8 text', async () => {
    const answer = {
      ...message('a', 'assistant', [
        { contentType: 'text', body: 'Partial answer' },
      ]),
      stopped: true,
    };
    const m = message('u', 'user', [
      {
        contentType: 'attachment',
        fileName: 'note.TXT',
        body: btoa('legacy file'),
      },
    ]);
    const data = await buildConversationExport([m, answer], options, vi.fn());
    expect(data.files[0].text).toBe('legacy file');
    expect(serializeConversationExport(data, 'markdown')).toContain(
      'Assistant — stopped'
    );
    expect(data.notes.join(' ')).toContain('incomplete');
  });
  it('propagates cancellation instead of returning an incomplete finished export', async () => {
    const error = new Error('closed');
    error.name = 'CanceledError';
    await expect(
      buildConversationExport(
        [message('u', 'user', [file])],
        options,
        async () => {
          throw error;
        }
      )
    ).rejects.toThrow('closed');
  });
});
