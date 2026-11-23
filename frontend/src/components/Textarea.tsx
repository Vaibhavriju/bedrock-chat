import { forwardRef, useEffect, useRef } from 'react';
import { BaseProps } from '../@types/common';
import { twMerge } from 'tailwind-merge';

type Props = BaseProps & {
  value?: string;
  label?: string;
  hideLabel?: boolean;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
  noBorder?: boolean;
  rows?: number;
  onChange?: (value: string) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
};

const MAX_HEIGHT = 300;

const Textarea = forwardRef<HTMLElement, Props>((props, focusInputRef) => {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    ref.current.style.height = 'auto';

    if (ref.current.scrollHeight > MAX_HEIGHT) {
      ref.current.style.height = MAX_HEIGHT + 'px';
    } else {
      ref.current.style.height = ref.current.scrollHeight + 'px';
    }
  }, [props.value]);

  return (
    <div className={`${props.className ?? ''} flex w-full flex-col`}>
      <textarea
        ref={(element) => {
          ref.current = element;
          if (focusInputRef) {
            if (typeof focusInputRef === 'function') {
              focusInputRef(element);
            } else {
              focusInputRef.current = element;
            }
          }
        }}
        className={twMerge(
          'peer w-full resize-none rounded-sm bg-white p-1.5 outline-hidden dark:bg-aws-ui-color-dark dark:placeholder-aws-font-color-gray',
          'overflow-y-auto',
          props.noBorder
            ? ''
            : 'border border-aws-font-color-light/50 dark:border-aws-font-color-dark/50',
          props.className
        )}
        rows={props.rows ?? 1}
        aria-label={props.label || props.placeholder}
        placeholder={props.placeholder}
        disabled={props.disabled}
        value={props.value}
        onKeyDown={props.onKeyDown}
        onChange={(e) => {
          props.onChange?.(e.target.value);
        }}
      />
      {props.label && !props.hideLabel && (
        <div className="order-first text-sm text-dark-gray peer-focus:font-semibold peer-focus:text-aws-font-color-light peer-focus:italic dark:text-light-gray dark:peer-focus:text-aws-font-color-dark">
          {props.label}
        </div>
      )}
      {props.hint && (
        <div className="mt-0.5 text-xs text-gray dark:text-aws-font-color-dark">
          {props.hint}
        </div>
      )}
    </div>
  );
});

export default Textarea;
