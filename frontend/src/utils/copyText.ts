import copy from 'copy-to-clipboard';

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* A browser permission can block the modern clipboard API. */
    }
  }
  if (!copy(text)) {
    throw new Error('Copy failed. Download the text instead.');
  }
}

export function downloadText(
  text: string,
  filename: string,
  mime = 'text/plain'
) {
  const url = URL.createObjectURL(
    new Blob([text], { type: `${mime};charset=utf-8` })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
