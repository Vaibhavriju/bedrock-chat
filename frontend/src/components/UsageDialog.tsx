import { useEffect, useRef, useState } from 'react';
import { Model } from '../@types/conversation';
import { UsageSnapshot } from '../@types/usage-control';
import useHttp from '../hooks/useHttp';
import ModalDialog from './ModalDialog';
import UsageSummary from './UsageSummary';

export default function UsageDialog({
  model,
  onClose,
}: {
  model: Model;
  onClose: () => void;
}) {
  const http = useHttp();
  const loader = useRef(http.getOnce);
  loader.current = http.getOnce;
  const [data, setData] = useState<UsageSnapshot>();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setData(undefined);
    setError(false);
    setLoading(true);
    loader
      .current<UsageSnapshot>('usage/me', { model }, undefined, abort.signal)
      .then((response) => {
        if (!abort.signal.aborted) {
          setData(response.data);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setError(true);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) {
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [model, refresh]);
  return (
    <ModalDialog isOpen title="Your usage" showCloseIcon onClose={onClose}>
      <p className="mb-4 text-sm">
        Generation requests for {model}. Shared workspace and model caps also
        apply.
      </p>
      {loading && <p role="status">Loading usage…</p>}
      {error && <p role="alert">Usage could not be loaded. Try refreshing.</p>}
      {data && <UsageSummary data={data} />}
      <button
        type="button"
        className="mt-4 rounded-lg border border-gray/30 px-3 py-2"
        onClick={() => setRefresh((value) => value + 1)}>
        Refresh usage
      </button>
    </ModalDialog>
  );
}
