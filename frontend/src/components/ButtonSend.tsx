import React from 'react';
import {
  PiPaperPlaneRightFill,
  PiSpinnerGap,
  PiStopFill,
} from 'react-icons/pi';
import { BaseProps } from '../@types/common';
import { twMerge } from 'tailwind-merge';

type Props = BaseProps & {
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
  onStop?: () => void;
  stopping?: boolean;
};

const ButtonSend: React.FC<Props> = (props) => {
  const canStop = Boolean(props.loading && props.onStop);
  const label = canStop
    ? props.stopping
      ? 'Stopping generation'
      : 'Stop generation'
    : props.loading
      ? 'Generating response'
      : 'Send message';
  return (
    <button
      type="button"
      className={twMerge(
        'flex items-center justify-center rounded-xl p-2 text-xl',
        'bg-aws-sea-blue-light text-white hover:bg-aws-sea-blue-hover-light',
        'dark:bg-aws-sea-blue-dark dark:hover:bg-aws-sea-blue-hover-dark',
        !canStop && props.disabled ? 'opacity-30' : '',
        props.className
      )}
      aria-label={label}
      title={label}
      onClick={canStop ? props.onStop : props.onClick}
      disabled={canStop ? props.stopping : props.disabled || props.loading}>
      {canStop && !props.stopping ? (
        <PiStopFill />
      ) : props.loading ? (
        <PiSpinnerGap className="animate-spin" />
      ) : (
        <PiPaperPlaneRightFill />
      )}
    </button>
  );
};

export default ButtonSend;
