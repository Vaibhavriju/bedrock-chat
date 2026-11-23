import React, {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import ButtonSend from './ButtonSend';
import Textarea from './Textarea';
import { AttachmentType } from '../hooks/useChat';
import Button from './Button';
import {
  PiArrowsCounterClockwise,
  PiX,
  PiArrowFatLineRight,
} from 'react-icons/pi';
import { LuFilePlus2 } from 'react-icons/lu';
import { useTranslation } from 'react-i18next';
import ButtonIcon from './ButtonIcon';
import useModel from '../hooks/useModel';
import { twMerge } from 'tailwind-merge';
import { create } from 'zustand';
import ButtonFileChoose from './ButtonFileChoose';
import ButtonReasoning from './ButtonReasoning';
import { BaseProps } from '../@types/common';
import ModalDialog from './ModalDialog';
import useSnackbar from '../hooks/useSnackbar';
import useAttachmentUploads from '../hooks/useAttachmentUploads';
import { formatFileSize, supportedAttachment } from '../utils/attachments';

type Props = BaseProps & {
  disabledSend?: boolean;
  disabledRegenerate?: boolean;
  disabledContinue?: boolean;
  disabled?: boolean;
  placeholder?: string;
  suggestedPrompt?: { text: string; id: number };
  dndMode?: boolean;
  canRegenerate: boolean;
  canContinue: boolean;
  isLoading: boolean;
  isNewChat?: boolean;
  onSend: (
    content: string,
    enableReasoning: boolean,
    base64EncodedImages?: string[],
    attachments?: AttachmentType[]
  ) => void;
  onRegenerate: (enableReasoning: boolean) => void;
  continueGenerate: () => void;
  supportReasoning: boolean;
  reasoningEnabled: boolean;
  onChangeReasoning: (enabled: boolean) => void;
};
// Image size
// Ref: https://docs.anthropic.com/en/docs/build-with-claude/vision#evaluate-image-size
const MAX_IMAGE_WIDTH = 1568;
const MAX_IMAGE_HEIGHT = 1568;
// Only resized inline images share the legacy payload budget. Files upload to S3.
const MAX_IMAGE_PAYLOAD_BYTES = 6 * 1024 * 1024;

const useInputChatContentState = create<{
  base64EncodedImages: string[];
  pushBase64EncodedImage: (image: string) => boolean;
  removeBase64EncodedImage: (index: number) => void;
  clearBase64EncodedImages: () => void;
  previewImageUrl: string | null;
  setPreviewImageUrl: (url: string | null) => void;
  isOpenPreviewImage: boolean;
  setIsOpenPreviewImage: (open: boolean) => void;
}>((set, get) => ({
  base64EncodedImages: [],
  pushBase64EncodedImage: (image) => {
    const images = get().base64EncodedImages;
    // Derive size from the actual queue, including concurrent FileReader results.
    if (
      images.length >= 20 ||
      images.reduce((n, value) => n + value.length, image.length) >
        MAX_IMAGE_PAYLOAD_BYTES
    ) {
      return false;
    }
    set({ base64EncodedImages: [...images, image] });
    return true;
  },
  removeBase64EncodedImage: (index) =>
    set({
      base64EncodedImages: get().base64EncodedImages.filter(
        (_, i) => i !== index
      ),
    }),
  clearBase64EncodedImages: () => set({ base64EncodedImages: [] }),
  previewImageUrl: null,
  setPreviewImageUrl: (previewImageUrl) => set({ previewImageUrl }),
  isOpenPreviewImage: false,
  setIsOpenPreviewImage: (isOpenPreviewImage) => set({ isOpenPreviewImage }),
}));

const InputChatContent = forwardRef<HTMLElement, Props>(
  (props, focusInputRef) => {
    const { t } = useTranslation();
    const {
      disabledImageUpload,
      model,
      acceptMediaType,
      forceReasoningEnabled,
    } = useModel();

    const [content, setContent] = useState('');
    const { reasoningEnabled, onChangeReasoning } = props;

    const {
      base64EncodedImages,
      pushBase64EncodedImage,
      removeBase64EncodedImage,
      clearBase64EncodedImages,
      previewImageUrl,
      setPreviewImageUrl,
      isOpenPreviewImage,
      setIsOpenPreviewImage,
    } = useInputChatContentState();

    useEffect(() => {
      clearBase64EncodedImages();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const { open } = useSnackbar();
    useEffect(() => {
      if (props.suggestedPrompt) {
        setContent(props.suggestedPrompt.text);
      }
    }, [props.suggestedPrompt, setContent]);

    const uploads = useAttachmentUploads();
    const needsDocumentModel =
      uploads.items.some((item) => item.ready?.kind === 'document') &&
      !model?.modelId.startsWith('claude-');
    const disabledSend =
      (!content.trim() &&
        uploads.items.length === 0 &&
        base64EncodedImages.length === 0) ||
      props.disabledSend ||
      uploads.busy ||
      uploads.hasErrors ||
      needsDocumentModel;

    const inputRef = useRef<HTMLDivElement>(null);

    const sendContent = useCallback(() => {
      if (disabledSend || props.disabled || props.isLoading) {
        return;
      }
      const attachments = uploads.items.flatMap((item) =>
        item.ready
          ? [
              {
                fileName: item.ready.fileName,
                fileType: item.file.type,
                extractedContent: '',
                objectKey: item.ready.objectKey,
              },
            ]
          : []
      );

      props.onSend(
        content.trim() ? content : 'Please analyze the attached files.',
        props.reasoningEnabled,
        !disabledImageUpload && base64EncodedImages.length > 0
          ? base64EncodedImages
          : undefined,
        attachments.length > 0 ? attachments : undefined
      );
      setContent('');
      uploads.clear();
      clearBase64EncodedImages();
    }, [
      base64EncodedImages,
      uploads,
      disabledSend,
      clearBase64EncodedImages,
      content,
      disabledImageUpload,
      props,
    ]);

    const encodeAndPushImage = useCallback(
      (imageFile: File) => {
        const reader = new FileReader();
        reader.readAsArrayBuffer(imageFile);
        reader.onload = () => {
          if (!reader.result) {
            return;
          }

          const img = new Image();
          img.src = URL.createObjectURL(new Blob([reader.result]));
          img.onload = async () => {
            const width = img.naturalWidth;
            const height = img.naturalHeight;

            // determine image size
            const aspectRatio = width / height;
            let newWidth;
            let newHeight;
            if (aspectRatio > 1) {
              newWidth = width > MAX_IMAGE_WIDTH ? MAX_IMAGE_WIDTH : width;
              newHeight =
                width > MAX_IMAGE_WIDTH
                  ? MAX_IMAGE_WIDTH / aspectRatio
                  : height;
            } else {
              newHeight = height > MAX_IMAGE_HEIGHT ? MAX_IMAGE_HEIGHT : height;
              newWidth =
                height > MAX_IMAGE_HEIGHT
                  ? MAX_IMAGE_HEIGHT * aspectRatio
                  : width;
            }

            // resize image using canvas
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = newWidth;
            canvas.height = newHeight;
            ctx?.drawImage(img, 0, 0, newWidth, newHeight);

            const resizedImageData = canvas.toDataURL('image/png');

            if (!pushBase64EncodedImage(resizedImageData)) {
              open(
                'Attach up to 20 images within a 6 MB resized-image budget. Remove an image and try again.'
              );
            }
          };
        };
      },
      [pushBase64EncodedImage, open]
    );

    useEffect(() => {
      const currentElem = inputRef?.current;
      const pasteListener = (e: DocumentEventMap['paste']) => {
        const clipboardItems = e.clipboardData?.items;
        if (!clipboardItems || clipboardItems.length === 0) {
          return;
        }

        for (let i = 0; i < clipboardItems.length; i++) {
          if (model?.supportMediaType.includes(clipboardItems[i].type)) {
            const pastedFile = clipboardItems[i].getAsFile();
            if (pastedFile) {
              encodeAndPushImage(pastedFile);
              e.preventDefault();
            }
          }
        }
      };
      currentElem?.addEventListener('paste', pasteListener);

      return () => {
        currentElem?.removeEventListener('paste', pasteListener);
      };
    });

    const onChangeFile = (fileList: FileList) => {
      if (props.disabled || props.isLoading) {
        return;
      }
      const files: File[] = [];
      for (const file of Array.from(fileList)) {
        if (supportedAttachment(file.name)) {
          files.push(file);
        } else if (
          acceptMediaType.some((ext) => file.name.toLowerCase().endsWith(ext))
        ) {
          encodeAndPushImage(file);
        } else {
          open(
            `${file.name}: unsupported format. Use text, code, PDF, Office documents or a source ZIP.`
          );
        }
      }
      const errors = uploads.add(files);
      if (errors.length) {
        open(errors.join('\n'));
      }
    };

    const onDragOver: React.DragEventHandler<HTMLDivElement> = useCallback(
      (e) => {
        e.preventDefault();
      },
      []
    );

    const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
      e.preventDefault();
      onChangeFile(e.dataTransfer.files);
    };

    return (
      <>
        {props.dndMode && (
          <div
            className="fixed top-0 left-0 size-full bg-black/40"
            onDrop={onDrop}></div>
        )}
        <div
          ref={inputRef}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={twMerge(
            'workspace-composer relative flex w-full shrink-0 flex-col gap-1 rounded-2xl border border-gray/20 bg-white shadow-sm dark:bg-aws-ui-color-dark',
            props.className
          )}>
          <div className="flex w-full">
            <Textarea
              key={`textarea-${props.isNewChat}`} // Add a key to force re-render
              className="min-w-0 scrollbar-thin bg-transparent"
              label="Message BatteryPool AI"
              hideLabel
              placeholder={
                props.placeholder ??
                (props.isNewChat
                  ? 'Ask a question, review code, or drop files here…'
                  : 'Ask a follow-up…')
              }
              disabled={props.disabled}
              noBorder
              rows={2}
              value={content}
              onChange={setContent}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229
                ) {
                  event.preventDefault();
                  sendContent();
                }
              }}
              ref={focusInputRef}
            />
          </div>
          <div className="right-0 bottom-0 flex w-full items-center justify-between px-2">
            <div className="flex">
              <ButtonFileChoose
                disabled={props.isLoading || props.disabled}
                icon
                onChange={onChangeFile}>
                <span title="Attach files up to 25 MB each">
                  <LuFilePlus2 />
                  <span className="sr-only">Attach files</span>
                </span>
              </ButtonFileChoose>
              {props.supportReasoning && (
                <ButtonReasoning
                  disabled={props.isLoading || props.canContinue}
                  showReasoning={reasoningEnabled}
                  forceReasoningEnabled={forceReasoningEnabled}
                  onToggleReasoning={() => onChangeReasoning(!reasoningEnabled)}
                />
              )}
            </div>
            <ButtonSend
              className="m-2 align-bottom"
              disabled={disabledSend || props.disabled}
              loading={props.isLoading}
              onClick={sendContent}
            />
          </div>
          {base64EncodedImages.length > 0 && (
            <div className="relative m-2 flex max-h-28 shrink-0 flex-wrap gap-3 overflow-y-auto p-2">
              {base64EncodedImages.map((imageFile, idx) => (
                <div key={idx} className="relative">
                  <img
                    src={imageFile}
                    className="h-16 rounded-sm border border-aws-squid-ink-light dark:border-aws-squid-ink-dark"
                    onClick={() => {
                      setPreviewImageUrl(imageFile);
                      setIsOpenPreviewImage(true);
                    }}
                  />
                  <ButtonIcon
                    className="absolute top-0 left-0 -m-2 border border-aws-sea-blue-light bg-white p-1 text-xs text-aws-sea-blue-light dark:border-aws-sea-blue-dark dark:text-aws-sea-blue-dark"
                    onClick={() => {
                      removeBase64EncodedImage(idx);
                    }}>
                    <PiX />
                  </ButtonIcon>
                </div>
              ))}
              <ModalDialog
                isOpen={isOpenPreviewImage}
                onClose={() => setIsOpenPreviewImage(false)}
                // Set image null after transition end
                onAfterLeave={() => setPreviewImageUrl(null)}
                widthFromContent={true}>
                {previewImageUrl && (
                  <img
                    src={previewImageUrl}
                    className="mx-auto max-h-[80vh] max-w-full rounded-md"
                  />
                )}
              </ModalDialog>
            </div>
          )}
          <div className="workspace-composer-help px-4 pb-3 text-xs leading-relaxed text-dark-gray dark:text-light-gray">
            <p>
              Code, source ZIPs, PDFs, spreadsheets & slides · 25 MB/file · 10
              files · 100 MB total
            </p>
            <p className="mt-1 opacity-75">
              Up to 600,000 extracted characters per conversation. Enter to send
              · Shift+Enter for a new line.
            </p>
          </div>
          {needsDocumentModel && (
            <p
              role="alert"
              className="mx-4 mb-3 text-sm text-amber-700 dark:text-amber-300">
              Choose a Claude model to read the original PDF, DOC or XLS
              attachment.
            </p>
          )}
          {uploads.items.length > 0 && (
            <div
              className="mx-3 mb-3 grid max-h-40 shrink-0 gap-2 overflow-y-auto overscroll-contain"
              aria-live="polite">
              {uploads.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-gray/30 bg-light-gray/30 p-3 dark:bg-aws-paper-dark">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate text-sm font-medium"
                        title={item.file.name}>
                        {item.file.name}
                      </div>
                      <div className="mt-1 text-xs opacity-75">
                        {formatFileSize(item.size)} ·{' '}
                        {item.status === 'ready'
                          ? 'Ready'
                          : item.status === 'processing'
                            ? 'Reading file…'
                            : item.status === 'uploading'
                              ? `Uploading ${item.progress}%`
                              : item.status === 'error'
                                ? 'Needs attention'
                                : 'Waiting to upload'}
                      </div>
                    </div>
                    {item.status === 'error' && (
                      <button
                        type="button"
                        className="text-xs underline"
                        onClick={() => uploads.retry(item)}>
                        Retry
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove ${item.file.name}`}
                      className="rounded p-1 hover:bg-gray/20"
                      onClick={() => uploads.remove(item.id)}>
                      <PiX />
                    </button>
                  </div>
                  {item.status === 'uploading' && (
                    <progress
                      className="mt-2 h-1 w-full"
                      value={item.progress}
                      max={100}
                      aria-label={`Uploading ${item.file.name}`}
                    />
                  )}
                  {item.ready && (
                    <p className="mt-2 text-xs opacity-75">
                      {item.ready.notice}
                      {item.ready.characters > 0
                        ? ` ${item.ready.characters.toLocaleString()} characters.`
                        : ''}
                    </p>
                  )}
                  {item.error && (
                    <p
                      role="alert"
                      className="mt-2 text-xs text-red dark:text-red">
                      {item.error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          {props.canRegenerate && (
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-gray/15 p-2">
              {props.canContinue &&
                !props.disabledContinue &&
                !props.disabled && (
                  <Button
                    className="bg-aws-paper-light p-2 text-sm dark:bg-aws-paper-dark"
                    outlined
                    onClick={props.continueGenerate}>
                    <PiArrowFatLineRight className="mr-2" />
                    {t('button.continue')}
                  </Button>
                )}
              <Button
                className="bg-aws-paper-light p-2 text-sm dark:bg-aws-paper-dark"
                outlined
                disabled={props.disabledRegenerate || props.disabled}
                onClick={() => {
                  props.onRegenerate(reasoningEnabled);
                }}>
                <PiArrowsCounterClockwise className="mr-2" />
                {t('button.regenerate')}
              </Button>
            </div>
          )}
        </div>
      </>
    );
  }
);

export default InputChatContent;
