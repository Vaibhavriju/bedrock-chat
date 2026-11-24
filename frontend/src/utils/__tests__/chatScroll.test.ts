import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatScrollController } from '../chatScroll';

class Viewport extends EventTarget {
  scrollTop = 0;
  scrollHeight = 2400;
  clientHeight = 600;
  tagName = 'DIV';
  isContentEditable = false;
  scrollTo = vi.fn(({ top }: { top: number }) => {
    this.scrollTop = Math.max(
      0,
      Math.min(top, this.scrollHeight - this.clientHeight)
    );
  });
  userScroll(top: number) {
    this.scrollTop = top;
    this.dispatchEvent(new Event('scroll'));
  }
}
let viewport: Viewport;
let controller: ReturnType<typeof createChatScrollController>;
let resize: () => void;
let disconnect: ReturnType<typeof vi.fn>;
let report: ReturnType<typeof vi.fn<(away: boolean) => void>>;
let frames: Map<number, FrameRequestCallback>;
let serial: number;
const flush = () => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(0));
};
const fire = (type: string, data: Record<string, unknown>) => {
  viewport.dispatchEvent(Object.assign(new Event(type), data));
};

beforeEach(() => {
  frames = new Map();
  serial = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    }
  );
  viewport = new Viewport();
  report = vi.fn<(away: boolean) => void>();
  controller = createChatScrollController(
    viewport as unknown as HTMLElement,
    {} as HTMLElement,
    report
  );
});
afterEach(() => {
  controller.destroy();
  vi.unstubAllGlobals();
});

describe('conversation scroll ownership', () => {
  it('follows initial history and coalesces streamed updates into one frame', () => {
    controller.followOutput();
    controller.followOutput();
    viewport.scrollHeight = 3000;
    flush();
    expect(viewport.scrollTop).toBe(2400);
    expect(viewport.scrollTo).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenLastCalledWith(false);
  });
  it('cancels a pending jump immediately when the reader wheels upward', () => {
    controller.jumpToBottom();
    controller.followOutput();
    fire('wheel', { deltaY: -100 });
    viewport.userScroll(1000);
    viewport.scrollHeight = 4000;
    resize();
    controller.followOutput();
    flush();
    expect(viewport.scrollTop).toBe(1000);
    expect(report).toHaveBeenLastCalledWith(true);
    expect(frames.size).toBe(0);
  });
  it('resumes following when the reader scrolls back to the latest message', () => {
    controller.jumpToBottom();
    viewport.userScroll(400);
    viewport.userScroll(1780);
    viewport.scrollHeight = 2800;
    resize();
    flush();
    expect(viewport.scrollTop).toBe(2200);
  });

  it('respects a small deliberate upward scroll even inside the bottom tolerance', () => {
    controller.jumpToBottom();
    viewport.userScroll(1780);
    viewport.scrollHeight = 3000;
    resize();
    flush();
    expect(viewport.scrollTop).toBe(1780);
    expect(report).toHaveBeenLastCalledWith(true);
    viewport.userScroll(2400);
    viewport.scrollHeight = 3200;
    resize();
    flush();
    expect(viewport.scrollTop).toBe(2600);
  });
  it('lets Jump to latest resume following after reading older content', () => {
    controller.jumpToBottom();
    viewport.userScroll(500);
    controller.jumpToBottom();
    viewport.clientHeight = 400;
    resize();
    flush();
    expect(viewport.scrollTop).toBe(2000);
    expect(report).toHaveBeenLastCalledWith(false);
  });
  it('does not snap back during a Page Up key or upward touch gesture', () => {
    controller.jumpToBottom();
    controller.followOutput();
    fire('keydown', { key: 'PageUp' });
    flush();
    expect(frames.size).toBe(0);
    viewport.userScroll(900);
    viewport.scrollHeight = 2600;
    resize();
    flush();
    expect(viewport.scrollTop).toBe(900);
    controller.jumpToBottom();
    controller.followOutput();
    fire('touchstart', { touches: [{ clientY: 200 }] });
    fire('touchmove', { touches: [{ clientY: 300 }] });
    expect(frames.size).toBe(0);
  });
  it('follows delayed image and diagram layout only while at the bottom', () => {
    controller.jumpToBottom();
    viewport.scrollHeight = 3400;
    resize();
    flush();
    expect(viewport.scrollTop).toBe(2800);
    viewport.userScroll(800);
    viewport.scrollHeight = 4400;
    resize();
    flush();
    expect(viewport.scrollTop).toBe(800);
  });
  it('resets the reading position and following state for another conversation', () => {
    controller.jumpToBottom();
    viewport.userScroll(800);
    controller.reset();
    expect(viewport.scrollTop).toBe(0);
    controller.followOutput();
    flush();
    expect(viewport.scrollTop).toBe(1800);
  });
  it('cleans up pending work and observers when the conversation unmounts', () => {
    controller.followOutput();
    controller.destroy();
    flush();
    resize();
    expect(viewport.scrollTo).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(disconnect).toHaveBeenCalled();
    report.mockClear();
    viewport.userScroll(900);
    expect(report).not.toHaveBeenCalled();
  });
});
