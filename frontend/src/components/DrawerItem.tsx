import React, { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { twMerge } from 'tailwind-merge';

type Props = {
  className?: string;
  isActive?: boolean;
  isEditing?: boolean;
  to: string;
  icon: ReactNode;
  labelComponent: ReactNode;
  actionComponent?: ReactNode;
  onClick?: () => void;
};

const DrawerItem: React.FC<Props> = (props) => {
  const label = (
    <>
      <span className="shrink-0" aria-hidden="true">
        {props.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{props.labelComponent}</span>
    </>
  );
  return (
    <div
      className={twMerge(
        'group mx-2 my-1 flex min-h-10 min-w-0 items-center rounded-xl',
        props.isActive
          ? 'bg-aws-sea-blue-light/10 text-aws-sea-blue-light dark:text-aws-sea-blue-dark'
          : 'hover:bg-aws-sea-blue-light/5 dark:hover:bg-aws-paper-dark',
        props.className
      )}>
      {props.isEditing ? (
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2">
          {label}
        </div>
      ) : (
        <Link
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2"
          aria-current={props.isActive ? 'page' : undefined}
          to={props.to}
          onClick={props.onClick}>
          {label}
        </Link>
      )}
      {props.actionComponent && (
        <div className="flex shrink-0">{props.actionComponent}</div>
      )}
    </div>
  );
};

export default DrawerItem;
