import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import useHttp from './useHttp';
import { validateAttachment } from '../utils/attachments';

export type ReadyAttachment = {
  objectKey: string;
  fileName: string;
  kind: 'text' | 'document';
  size: number;
  characters: number;
  notice: string;
};

export type UploadItem = {
  id: string;
  file: File;
  size: number;
  progress: number;
  status: 'queued' | 'uploading' | 'processing' | 'ready' | 'error';
  ready?: ReadyAttachment;
  error?: string;
};

export default function useAttachmentUploads() {
  const http = useHttp();
  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef<UploadItem[]>([]);
  const chain = useRef(Promise.resolve());
  const mounted = useRef(true);
  const controllers = useRef(new Map<string, AbortController>());

  useEffect(() => {
    mounted.current = true;
    const activeControllers = controllers.current;
    return () => {
      mounted.current = false;
      activeControllers.forEach((c) => c.abort());
    };
  }, []);

  const update = (id: string, change: Partial<UploadItem>) => {
    if (!mounted.current) {
      return;
    }
    itemsRef.current = itemsRef.current.map((item) =>
      item.id === id ? { ...item, ...change } : item
    );
    setItems(itemsRef.current);
  };

  const upload = async (item: UploadItem) => {
    if (!mounted.current || !itemsRef.current.some((i) => i.id === item.id)) {
      return;
    }
    const controller = new AbortController();
    controllers.current.set(item.id, controller);
    try {
      update(item.id, { status: 'uploading', progress: 0, error: undefined });
      const { data } = await http.post<{
        uploadId: string;
        url: string;
        fields: Record<string, string>;
      }>('attachments/uploads', { filename: item.file.name, size: item.size });
      if (controller.signal.aborted) {
        return;
      }
      const form = new FormData();
      Object.entries(data.fields).forEach(([key, value]) =>
        form.append(key, value)
      );
      form.append('file', item.file);
      // A separate client deliberately sends no application Authorization header to S3.
      await axios.post(data.url, form, {
        signal: controller.signal,
        onUploadProgress: (event) =>
          update(item.id, {
            progress: Math.min(
              100,
              Math.round((100 * event.loaded) / (event.total || item.size))
            ),
          }),
      });
      update(item.id, { status: 'processing', progress: 100 });
      const result = await http.post<ReadyAttachment>(
        `attachments/uploads/${data.uploadId}/complete`,
        {}
      );
      if (!controller.signal.aborted) {
        update(item.id, { status: 'ready', ready: result.data });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      const message = axios.isAxiosError(error)
        ? error.response?.data?.errors?.[0]
        : undefined;
      update(item.id, {
        status: 'error',
        error:
          message ||
          'Upload could not finish. Check your connection and retry.',
      });
    } finally {
      controllers.current.delete(item.id);
    }
  };

  const add = (files: File[]) => {
    const errors: string[] = [];
    for (const file of files) {
      const error = validateAttachment(file, itemsRef.current);
      if (error) {
        errors.push(`${file.name}: ${error}`);
        continue;
      }
      if (
        itemsRef.current.some(
          (i) =>
            i.file.name === file.name &&
            i.size === file.size &&
            i.file.lastModified === file.lastModified
        )
      ) {
        errors.push(`${file.name} is already attached.`);
        continue;
      }
      const item: UploadItem = {
        id: crypto.randomUUID(),
        file,
        size: file.size,
        progress: 0,
        status: 'queued',
      };
      itemsRef.current = [...itemsRef.current, item];
      setItems(itemsRef.current);
      chain.current = chain.current.then(() => upload(item));
    }
    return errors;
  };

  return {
    items,
    add,
    busy: items.some((i) =>
      ['queued', 'uploading', 'processing'].includes(i.status)
    ),
    hasErrors: items.some((i) => i.status === 'error'),
    remove: (id: string) => {
      controllers.current.get(id)?.abort();
      itemsRef.current = itemsRef.current.filter((i) => i.id !== id);
      setItems(itemsRef.current);
    },
    retry: (item: UploadItem) => {
      update(item.id, { status: 'queued', error: undefined });
      chain.current = chain.current.then(() => upload(item));
    },
    clear: () => {
      controllers.current.forEach((c) => c.abort());
      itemsRef.current = [];
      setItems([]);
    },
  };
}
