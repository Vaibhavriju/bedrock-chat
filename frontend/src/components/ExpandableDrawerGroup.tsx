import React, { ReactNode, useState } from 'react';
import { PiCaretDown } from 'react-icons/pi';
import { twMerge } from 'tailwind-merge';

type Props = {
  className?: string;
  label: string;
  children: ReactNode;
  isDefaultShow?: boolean;
};

const ExpandableDrawerGroup: React.FC<Props> = ({
  isDefaultShow = true,
  ...props
}) => {
  const [isShow, setIsShow] = useState(isDefaultShow);

  return (
    <div className={twMerge(props.className)}>
      <button
        type="button"
        aria-expanded={isShow}
        className="flex w-full items-center p-3 text-left text-xs font-semibold tracking-wide opacity-60 transition hover:opacity-100"
        onClick={() => {
          setIsShow(!isShow);
        }}>
        <PiCaretDown className={`mx-1 text-sm ${isShow ? '' : 'rotate-180'}`} />

        <span>{props.label}</span>
      </button>
      <div hidden={!isShow}>{props.children}</div>
    </div>
  );
};

export default ExpandableDrawerGroup;
