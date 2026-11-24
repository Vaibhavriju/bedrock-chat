import {
  MAX_ATTACHED_FILES,
  MAX_FILE_SIZE_BYTES,
  SUPPORTED_FILE_EXTENSIONS,
} from '../constants/supportedAttachedFiles';

export const MAX_DRAFT_BYTES = 100 * 1024 * 1024;
const SPECIAL_NAMES = new Set([
  'dockerfile',
  'makefile',
  'gemfile',
  'procfile',
  '.gitignore',
  '.dockerignore',
]);

export function supportedAttachment(name: string) {
  const lower = name.toLowerCase();
  return (
    SPECIAL_NAMES.has(lower) ||
    SUPPORTED_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext.toLowerCase()))
  );
}

export function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function validateAttachment(
  file: Pick<File, 'name' | 'size'>,
  current: { size: number }[]
) {
  if (!supportedAttachment(file.name)) {
    return 'Unsupported format. Use code, text, PDF, Office documents or a source ZIP.';
  }
  if (!file.size) {
    return 'This file is empty.';
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return 'Choose a file up to 25 MB. Split larger files or use a knowledge-base bot.';
  }
  if (current.length >= MAX_ATTACHED_FILES) {
    return 'Attach up to 10 files per message.';
  }
  if (current.reduce((n, f) => n + f.size, file.size) > MAX_DRAFT_BYTES) {
    return 'Attachments can total up to 100 MB per message.';
  }
  return undefined;
}
