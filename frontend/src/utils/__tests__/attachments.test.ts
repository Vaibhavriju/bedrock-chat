import { describe, expect, it } from 'vitest';
import {
  MAX_DRAFT_BYTES,
  supportedAttachment,
  validateAttachment,
} from '../attachments';
import { MAX_FILE_SIZE_BYTES } from '../../constants/supportedAttachedFiles';

describe('chat attachment validation', () => {
  it('accepts uppercase formats and extensionless developer files', () => {
    for (const name of [
      'REPORT.PDF',
      'script.TS',
      'source.ZIP',
      'Dockerfile',
      'Makefile',
      'slides.PPTX',
    ]) {
      expect(supportedAttachment(name)).toBe(true);
    }
    expect(supportedAttachment('malware.exe')).toBe(false);
  });
  it('handles exact size/count boundaries and removal without a stale counter', () => {
    expect(
      validateAttachment({ name: 'code.ts', size: MAX_FILE_SIZE_BYTES }, [])
    ).toBeUndefined();
    expect(
      validateAttachment({ name: 'code.ts', size: MAX_FILE_SIZE_BYTES + 1 }, [])
    ).toContain('25 MB');
    expect(
      validateAttachment(
        { name: 'code.ts', size: 1 },
        Array.from({ length: 10 }, () => ({ size: 1 }))
      )
    ).toContain('10 files');
    expect(
      validateAttachment({ name: 'code.ts', size: 1 }, [
        { size: MAX_DRAFT_BYTES },
      ])
    ).toContain('100 MB');
    expect(validateAttachment({ name: 'code.ts', size: 0 }, [])).toContain(
      'empty'
    );
    // A new draft / removed queue is the only input; no historical size state persists.
    expect(
      validateAttachment({ name: 'code.ts', size: 100 }, [])
    ).toBeUndefined();
  });
});
