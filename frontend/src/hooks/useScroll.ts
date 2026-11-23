import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createChatScrollController } from '../utils/chatScroll';

const useScroll = (conversationId?: string) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof createChatScrollController>>();
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  useLayoutEffect(() => {
    if (!viewportRef.current || !contentRef.current) {
      return;
    }
    const current = createChatScrollController(
      viewportRef.current,
      contentRef.current,
      setAwayFromBottom
    );
    controller.current = current;
    return () => {
      current.destroy();
      controller.current = undefined;
    };
  }, []);

  useLayoutEffect(() => {
    controller.current?.reset();
  }, [conversationId]);

  return {
    viewportRef,
    contentRef,
    awayFromBottom,
    scrollToTop: useCallback(() => controller.current?.reset(), []),
    scrollToBottom: useCallback(() => controller.current?.followOutput(), []),
    jumpToBottom: useCallback(() => controller.current?.jumpToBottom(), []),
  };
};

export default useScroll;
