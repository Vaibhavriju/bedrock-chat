/** Follow new output only while the reader is at the latest message. */
export function createChatScrollController(
  viewport: HTMLElement,
  content: HTMLElement,
  onAwayFromBottom: (away: boolean) => void
) {
  let following = true;
  let lastTop = viewport.scrollTop;
  let touchY: number | undefined;
  let frame: number | undefined;
  let disposed = false;
  const nearBottom = () =>
    viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 48;
  const reportPosition = () => onAwayFromBottom(!following || !nearBottom());
  const cancelFrame = () => {
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    }
  };
  const pause = () => {
    following = false;
    cancelFrame();
  };
  const writePosition = (top: number) => {
    lastTop = Math.max(0, top);
    viewport.scrollTo({ top: lastTop, behavior: 'instant' });
    reportPosition();
  };
  const followOutput = () => {
    if (!following || disposed || frame !== undefined) {
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (following && !disposed) {
        writePosition(viewport.scrollHeight - viewport.clientHeight);
      }
    });
  };
  const onScroll = () => {
    if (viewport.scrollTop < lastTop - 1) {
      pause();
    } else if (nearBottom()) {
      following = true;
    }
    lastTop = viewport.scrollTop;
    reportPosition();
  };
  const onWheel = (event: WheelEvent) => {
    if (event.deltaY < 0) {
      pause();
    }
  };
  const onTouchStart = (event: TouchEvent) => {
    touchY = event.touches[0]?.clientY;
  };
  const onTouchMove = (event: TouchEvent) => {
    const nextY = event.touches[0]?.clientY;
    if (nextY !== undefined && touchY !== undefined && nextY > touchY) {
      pause();
    }
    touchY = nextY;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }
    if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
      pause();
    }
  };

  viewport.addEventListener('scroll', onScroll, { passive: true });
  viewport.addEventListener('wheel', onWheel, { passive: true });
  viewport.addEventListener('touchstart', onTouchStart, { passive: true });
  viewport.addEventListener('touchmove', onTouchMove, { passive: true });
  viewport.addEventListener('keydown', onKeyDown);
  // Images, diagrams, fonts and a growing composer can change the bottom
  // without another message event. Never override a reader who scrolled up.
  const observer =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => {
          if (disposed) {
            return;
          }
          reportPosition();
          followOutput();
        });
  observer?.observe(viewport);
  observer?.observe(content);

  return {
    followOutput,
    reset() {
      cancelFrame();
      following = true;
      writePosition(0);
    },
    jumpToBottom() {
      cancelFrame();
      following = true;
      writePosition(viewport.scrollHeight - viewport.clientHeight);
    },
    destroy() {
      disposed = true;
      cancelFrame();
      observer?.disconnect();
      viewport.removeEventListener('scroll', onScroll);
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('keydown', onKeyDown);
    },
  };
}
