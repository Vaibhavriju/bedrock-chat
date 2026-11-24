import React from 'react';
import { PiFileText } from 'react-icons/pi';
import { BaseProps } from '../@types/common';
import { twMerge } from 'tailwind-merge';

type Props = BaseProps & {fileName: string; onClick?: () => void};
const UploadedAttachedFile: React.FC<Props> = ({fileName, onClick, className}) => {
  const content = <><span className="rounded-lg bg-aws-sea-blue-light/10 p-2 text-lg text-aws-sea-blue-light dark:text-aws-sea-blue-dark"><PiFileText aria-hidden="true" /></span><span className="min-w-0"><span className="block max-w-56 truncate text-sm font-medium">{fileName}</span><span className="mt-0.5 block text-xs opacity-60">{onClick ? 'Preview attachment' : 'Attached file'}</span></span></>;
  const style = twMerge('my-1 inline-flex max-w-full items-center gap-3 rounded-xl border border-gray/20 bg-white px-3 py-2 text-left dark:bg-aws-ui-color-dark',className);
  return onClick ? <button type="button" onClick={onClick} className={twMerge(style,'hover:border-aws-sea-blue-light/40')} aria-label={`Preview ${fileName}`} title={fileName}>{content}</button> : <div className={style} title={fileName}>{content}</div>;
};
export default UploadedAttachedFile;
