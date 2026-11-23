import { useMemo, useState } from 'react';
import { PiArrowsClockwise, PiMagnifyingGlass, PiRobot } from 'react-icons/pi';
import useHttp from '../hooks/useHttp';
import useLoginUser from '../hooks/useLoginUser';

type CatalogModel = {
  id: string;
  name: string;
  provider: string;
  lifecycle: string;
  streaming: boolean;
  appKey: string | null;
  configured: boolean;
  candidate: boolean;
  profileIds: string[];
  access: string;
  detail: string;
};
type Catalog = {
  region: string;
  checkedAt: string;
  notice: string;
  models: CatalogModel[];
  warnings: string[];
};
const accessLabels: Record<string, string> = {
  metadata_available: 'Access metadata available',
  restricted: 'Activation or permission required',
  pending: 'Activation pending',
  unknown: 'Access not confirmed',
  not_checked: 'Catalog listing only',
};

export default function AdminModelsPage() {
  const { isAdmin } = useLoginUser();
  const http = useHttp();
  const { data, error, isLoading, mutate, isValidating } = http.get<Catalog>(
    isAdmin ? 'admin/models' : null,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('relevant');
  const models = useMemo(
    () =>
      (data?.models || []).filter((model) => {
        const matches = `${model.name} ${model.id} ${model.provider}`
          .toLowerCase()
          .includes(search.toLowerCase().trim());
        return (
          matches &&
          (scope === 'all' ||
            (scope === 'configured'
              ? model.configured
              : model.configured || model.candidate))
        );
      }),
    [data, search, scope]
  );
  if (!isAdmin) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold">Model catalog</h1>
        <p className="mt-3">
          An administrator account is required to inspect model access.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-6xl p-5 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-aws-sea-blue-light dark:text-aws-sea-blue-dark">
            WORKSPACE ADMINISTRATION
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Model catalog
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed opacity-65">
            See what AWS lists, what the application supports, and which models
            still need activation. A listed or active profile does not prove
            that inference works.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void mutate()}
          disabled={isValidating}
          className="flex items-center gap-2 rounded-xl border border-gray/25 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50 dark:bg-aws-ui-color-dark">
          <PiArrowsClockwise className={isValidating ? 'animate-spin' : ''} />
          Reload
        </button>
      </div>
      <div className="my-6 rounded-2xl border border-aws-sea-blue-light/15 bg-aws-sea-blue-light/5 p-4 text-sm leading-relaxed">
        Discovery is read-only. It does not invoke or activate models, accept
        terms, change employee access, or confirm credit coverage. Metadata is
        cached for five minutes. Check inference using the application role
        before enabling a new model.
      </div>
      {data && (
        <div className="mb-6 flex flex-wrap gap-4 text-sm opacity-65">
          <span>Region: {data.region}</span>
          <span>Checked: {new Date(data.checkedAt).toLocaleString()}</span>
          <span>
            {data.models.filter((m) => m.configured).length} configured models
          </span>
        </div>
      )}
      <div className="mb-5 flex flex-wrap gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-gray/25 bg-white px-3 dark:bg-aws-ui-color-dark">
          <PiMagnifyingGlass />
          <input
            aria-label="Search model catalog"
            className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none"
            placeholder="Search models or providers"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Catalog filter"
          className="rounded-xl border border-gray/25 bg-white px-4 py-3 text-sm dark:bg-aws-ui-color-dark"
          value={scope}
          onChange={(e) => setScope(e.target.value)}>
          <option value="relevant">Workspace & new candidates</option>
          <option value="configured">Configured in workspace</option>
          <option value="all">All text models</option>
        </select>
      </div>
      {isLoading && (
        <p role="status" className="rounded-2xl border border-gray/20 p-6">
          Checking the Bedrock catalog…
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-red/20 bg-light-red p-5 text-red">
          Could not load the catalog. Check the application's Bedrock read
          permissions, then reload. Current chat models are unaffected.
        </div>
      )}
      {data?.warnings.map((warning) => (
        <p key={warning} role="status" className="mb-3 text-sm text-yellow">
          {warning}
        </p>
      ))}
      <div className="grid gap-4 lg:grid-cols-2">
        {models.map((model) => (
          <article
            key={model.id}
            className="min-w-0 rounded-2xl border border-gray/15 bg-white p-5 dark:bg-aws-ui-color-dark">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-aws-sea-blue-light/10 p-2.5 text-aws-sea-blue-light dark:text-aws-sea-blue-dark">
                <PiRobot />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium opacity-55">
                  {model.provider}
                </p>
                <h2 className="mt-1 text-base font-semibold">{model.name}</h2>
                <p className="mt-1 font-mono text-xs break-all opacity-55">
                  {model.id}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-aws-sea-blue-light/10 px-2.5 py-1">
                {model.configured
                  ? 'Configured in workspace'
                  : model.appKey
                    ? 'Adapter present · not enabled'
                    : 'App integration required'}
              </span>
              <span className="rounded-full bg-gray/10 px-2.5 py-1">
                {accessLabels[model.access] || 'Access not confirmed'}
              </span>
              <span className="rounded-full bg-gray/10 px-2.5 py-1">
                {model.streaming ? 'Streaming listed' : 'No streaming listed'}
              </span>
              <span className="rounded-full bg-gray/10 px-2.5 py-1">
                {model.lifecycle}
              </span>
            </div>
            <p className="mt-4 text-sm leading-relaxed opacity-65">
              {model.detail}
            </p>
            {model.profileIds.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-medium">
                  {model.profileIds.length} active inference profiles
                </summary>
                <ul className="mt-2 space-y-1 font-mono text-xs break-all opacity-65">
                  {model.profileIds.map((id) => (
                    <li key={id}>{id}</li>
                  ))}
                </ul>
              </details>
            )}
          </article>
        ))}
      </div>
      {data && !models.length && (
        <p className="py-10 text-center opacity-60">
          No models match this search.
        </p>
      )}
    </div>
  );
}
