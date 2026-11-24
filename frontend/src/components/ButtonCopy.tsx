import React, { useEffect, useRef, useState } from 'react';
import ButtonIcon from './ButtonIcon';
import { BaseProps } from '../@types/common';
import { PiCheck, PiClipboard, PiWarningCircle } from 'react-icons/pi';
import { copyText } from '../utils/copyText';

type Props = BaseProps & { text: string; label?: string };

const ButtonCopy: React.FC<Props> = ({
  text,
  label = 'Copy to clipboard',
  className,
}) => {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>(
    'idle'
  );
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  return (
    <>
      <ButtonIcon
        label={
          status === 'copied'
            ? 'Copied'
            : status === 'error'
              ? 'Copy failed. Try downloading instead.'
              : label
        }
        className={className}
        disabled={status === 'copying' || !text}
        onClick={async () => {
          clearTimeout(timer.current);
          setStatus('copying');
          try {
            await copyText(text);
            if (mounted.current) {
              setStatus('copied');
            }
          } catch {
            if (mounted.current) {
              setStatus('error');
            }
          }
          if (!mounted.current) {
            return;
          }
          timer.current = setTimeout(() => setStatus('idle'), 3000);
        }}>
        {status === 'copied' ? (
          <PiCheck />
        ) : status === 'error' ? (
          <PiWarningCircle />
        ) : (
          <PiClipboard />
        )}
      </ButtonIcon>
      <span role="status" className="sr-only">
        {status === 'copied'
          ? 'Copied to clipboard'
          : status === 'error'
            ? 'Copy failed. Download the text instead.'
            : ''}
      </span>
    </>
  );
};
export default ButtonCopy;
