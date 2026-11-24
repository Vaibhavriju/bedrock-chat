import { describe, expect, it } from 'vitest';
import { makeStreamFrames } from '../streamFrames';

describe('WebSocket byte budgets', () => {
  it.each([{label: 'ASCII', input: 'hello'}, {label: 'Devanagari', input: 'कर्मचारी '.repeat(10000)}, {label: 'emoji', input: '🔋🚀'.repeat(15000)}, {label: 'escaped text', input: '\\"\n\t'.repeat(10000)}])('preserves content and bounds every $label frame', ({input}) => {
    const payload = JSON.stringify({ content: input });
    const frames = makeStreamFrames(payload, 'BODY');
    expect(frames.map((frame) => JSON.parse(frame).part).join('')).toBe(payload);
    frames.forEach((frame, index) => {
      expect(new TextEncoder().encode(frame).length).toBeLessThanOrEqual(30 * 1024);
      expect(JSON.parse(frame).index).toBe(index);
    });
  });
  it('rejects invalid budgets', () => expect(() => makeStreamFrames('x', 'BODY', 1)).toThrow());
});
