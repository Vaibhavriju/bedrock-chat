import { useEffect, useMemo, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import useHttp from '../hooks/useHttp';
import useLoginUser from '../hooks/useLoginUser';
import useModel from '../hooks/useModel';
import {
  emptyModelRule,
  emptyRule,
  UsagePolicy,
  UsageRule,
  UsageSnapshot,
} from '../@types/usage-control';
import UsageSummary from '../components/UsageSummary';

type LimitsResponse = {
  policy: UsagePolicy;
  configured: boolean;
  timezone: string;
  notice: string;
};
const numericFields = [
  ['dailyRequests', 'Requests per day'],
  ['monthlyRequests', 'Requests per month'],
  ['maxOutputTokens', 'Output tokens per model call'],
] as const;
const inputClass =
  'mt-1 w-full rounded-lg border border-gray/30 bg-white px-3 py-2 text-sm dark:bg-aws-paper-dark';
const buttonClass =
  'rounded-lg border border-gray/30 px-4 py-2 text-sm disabled:opacity-40';

function RuleFields({
  prefix,
  rule,
  onChange,
}: {
  prefix: string;
  rule: UsageRule;
  onChange: (key: keyof UsageRule, value: number | null) => void;
}) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      {numericFields.map(([key, label]) => (
        <label key={key} className="text-sm">
          {label}
          <input
            aria-label={`${prefix}: ${label}`}
            type="number"
            min={key === 'maxOutputTokens' ? 2048 : 0}
            max={key === 'maxOutputTokens' ? 128000 : 100000000}
            step={1}
            placeholder="No additional cap"
            className={inputClass}
            value={rule[key] ?? ''}
            onChange={(e) =>
              onChange(
                key,
                e.target.value === '' ? null : Number(e.target.value)
              )
            }
          />
        </label>
      ))}
    </div>
  );
}
function errorText(error: unknown): string {
  if (isAxiosError(error)) {
    const data = error.response?.data;
    if (Array.isArray(data?.errors)) {
      return data.errors.join(' ');
    }
    if (typeof data?.detail === 'string') {
      return data.detail;
    }
    if (Array.isArray(data?.detail)) {
      return 'Check that caps are whole numbers, request caps are 0 or greater, and output caps are 2,048–128,000.';
    }
  }
  return 'Could not save the limits. Your changes are still here; reload if another administrator updated them.';
}

export default function AdminLimitsPage() {
  const { isAdmin, userName } = useLoginUser();
  const { availableModels } = useModel();
  const http = useHttp();
  // Policies include employee-specific overrides. Fetch fresh authenticated data
  // instead of sharing a URL-only SWR cache across sign-in sessions.
  const httpRef = useRef(http);
  httpRef.current = http;
  const [data, setData] = useState<LimitsResponse>();
  const [error, setError] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  useEffect(() => {
    if (!isAdmin) {
      setData(undefined);
      return;
    }
    const abort = new AbortController();
    setData(undefined);
    setLoading(true);
    setError(false);
    httpRef.current
      .getOnce<LimitsResponse>(
        'admin/limits',
        undefined,
        undefined,
        abort.signal
      )
      .then((result) => {
        if (!abort.signal.aborted) {
          setData(result.data);
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
  }, [isAdmin, userName, refreshVersion]);
  const [draft, setDraft] = useState<UsagePolicy>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const [employee, setEmployee] = useState('');
  const [inspectEmail, setInspectEmail] = useState('');
  const [inspectModel, setInspectModel] = useState('');
  const [usage, setUsage] = useState<UsageSnapshot>();
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [usageError, setUsageError] = useState('');
  useEffect(() => {
    if (data && !dirty) {
      setDraft(structuredClone(data.policy));
    }
  }, [data, dirty]);
  const models = useMemo(() => {
    const options = new Map(
      availableModels.map((model) => [model.modelId as string, model.label])
    );
    for (const key of Object.keys(draft?.models || {})) {
      if (!options.has(key)) {
        options.set(key, key);
      }
    }
    return [...options.entries()];
  }, [availableModels, draft]);
  const update = (change: (next: UsagePolicy) => void) => {
    setDraft((value) => {
      if (!value) {
        return value;
      }
      const next = structuredClone(value);
      change(next);
      return next;
    });
    setDirty(true);
    setMessage('');
    setFailure('');
  };
  if (!isAdmin) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold">Usage limits</h1>
        <p className="mt-3">Only workspace administrators can change limits.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-5xl p-5 sm:p-8">
      <h1 className="text-3xl font-semibold">Usage limits</h1>
      <p className="mt-3 text-sm leading-relaxed">
        Set a shared workspace cap, employee defaults, model caps, and
        individual overrides. Limits reset at midnight in India; monthly limits
        reset on the first day. Blank means no additional cap. Employee blanks
        inherit the default; 0 requests blocks use.
      </p>
      <p className="mt-2 text-sm opacity-70">
        These count admitted generation requests, including stopped or failed
        attempts. Output limits apply to each model call. They are not token or
        dollar budgets; tool loops, title calls and other AWS usage can still
        add cost. Counters start with this release. Existing cost analytics are
        estimates and can omit models without configured pricing; use AWS
        Billing for actual charges.
      </p>
      {isLoading && (
        <p role="status" className="mt-5">
          Loading limits…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-5">
          Could not load limits. Refresh this page to retry.
        </p>
      )}
      {data && !data.configured && (
        <p role="alert" className="mt-5">
          The usage-control backend must finish deploying before limits can be
          saved.
        </p>
      )}
      {draft && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setFailure('');
            setMessage('');
            try {
              const result = await http.put<UsagePolicy>('admin/limits', draft);
              setData({ ...data!, policy: result.data });
              setDraft(structuredClone(result.data));
              setDirty(false);
              setMessage(
                'Limits saved. They apply to new generation requests.'
              );
            } catch (saveError) {
              setFailure(errorText(saveError));
            } finally {
              setSaving(false);
            }
          }}>
          <fieldset disabled={saving || !data?.configured}>
            {(['workspace', 'defaultUser'] as const).map((scope) => (
              <section
                key={scope}
                className="mt-6 rounded-2xl border border-gray/20 bg-white p-5 dark:bg-aws-ui-color-dark">
                <h2 className="text-lg font-semibold">
                  {scope === 'workspace'
                    ? 'Entire workspace'
                    : 'Default for each employee'}
                </h2>
                <RuleFields
                  prefix={
                    scope === 'workspace' ? 'Workspace' : 'Employee default'
                  }
                  rule={draft[scope]}
                  onChange={(key, value) =>
                    update((next) => {
                      next[scope][key] = value;
                    })
                  }
                />
              </section>
            ))}
            <section className="mt-6 rounded-2xl border border-gray/20 bg-white p-5 dark:bg-aws-ui-color-dark">
              <h2 className="text-lg font-semibold">Per model</h2>
              <p className="mt-2 text-sm opacity-70">
                A model's shared cap and its per-employee cap both apply, along
                with workspace and employee limits.
              </p>
              <div className="mt-3 space-y-3">
                {models.map(([key, label]) => {
                  const rule = draft.models[key] ?? emptyModelRule();
                  return (
                    <details
                      key={key}
                      className="rounded-xl border border-gray/20 p-3">
                      <summary className="cursor-pointer text-sm font-semibold">
                        {label}
                        {!rule.enabled ? ' · Disabled' : ''}
                      </summary>
                      <label className="mt-3 flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          aria-label={`${label}: Enable model`}
                          checked={rule.enabled}
                          onChange={(e) =>
                            update((next) => {
                              (next.models[key] ??= emptyModelRule()).enabled =
                                e.target.checked;
                            })
                          }
                        />
                        Enable for employees whose account permits it
                      </label>
                      <RuleFields
                        prefix={label}
                        rule={rule}
                        onChange={(field, value) =>
                          update((next) => {
                            (next.models[key] ??= emptyModelRule())[field] =
                              value;
                          })
                        }
                      />
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {(
                          [
                            [
                              'dailyRequestsPerUser',
                              'Requests per employee per day',
                            ],
                            [
                              'monthlyRequestsPerUser',
                              'Requests per employee per month',
                            ],
                          ] as const
                        ).map(([field, caption]) => (
                          <label key={field} className="text-sm">
                            {caption}
                            <input
                              aria-label={`${label}: ${caption}`}
                              type="number"
                              min={0}
                              step={1}
                              max={100000000}
                              className={inputClass}
                              value={rule[field] ?? ''}
                              placeholder="No additional cap"
                              onChange={(e) =>
                                update((next) => {
                                  (next.models[key] ??= emptyModelRule())[
                                    field
                                  ] =
                                    e.target.value === ''
                                      ? null
                                      : Number(e.target.value);
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </details>
                  );
                })}
              </div>
            </section>
            <section className="mt-6 rounded-2xl border border-gray/20 bg-white p-5 dark:bg-aws-ui-color-dark">
              <h2 className="text-lg font-semibold">Individual employees</h2>
              <p className="mt-2 text-sm opacity-70">
                Overrides replace that employee's defaults. Shared workspace and
                model caps still apply. Adding an override does not create an
                employee account.
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="min-w-0 flex-1 text-sm">
                  Employee email
                  <input
                    aria-label="Employee email"
                    type="email"
                    value={employee}
                    className={inputClass}
                    placeholder="name@batterypool.com"
                    onChange={(e) => setEmployee(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    const email = employee.trim().toLowerCase();
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                      setFailure(
                        'Enter the employee’s complete email address.'
                      );
                      return;
                    }
                    update((next) => {
                      next.users[email] ??= {
                        ...emptyRule(),
                        allowedModels: null,
                      };
                    });
                    setEmployee('');
                  }}>
                  Add override
                </button>
              </div>
              {Object.entries(draft.users).map(([email, rule]) => (
                <div
                  key={email}
                  className="mt-4 rounded-xl border border-gray/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold break-all">{email}</h3>
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() =>
                        update((next) => {
                          delete next.users[email];
                        })
                      }>
                      Remove override
                    </button>
                  </div>
                  <RuleFields
                    prefix={email}
                    rule={rule}
                    onChange={(key, value) =>
                      update((next) => {
                        next.users[email][key] = value;
                      })
                    }
                  />
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={rule.allowedModels !== null}
                      onChange={(e) =>
                        update((next) => {
                          next.users[email].allowedModels = e.target.checked
                            ? models.map(([key]) => key)
                            : null;
                        })
                      }
                    />
                    Limit this employee to selected models
                  </label>
                  {rule.allowedModels !== null && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {models.map(([key, label]) => (
                        <label
                          key={key}
                          className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            aria-label={`${email}: Allow ${label}`}
                            checked={rule.allowedModels?.includes(key) ?? false}
                            onChange={(e) =>
                              update((next) => {
                                const selected = new Set(
                                  next.users[email].allowedModels ?? []
                                );
                                if (e.target.checked) {
                                  selected.add(key);
                                } else {
                                  selected.delete(key);
                                }
                                next.users[email].allowedModels = [...selected];
                              })
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </section>
          </fieldset>
          <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-gray/20 bg-white p-4 shadow-sm dark:bg-aws-ui-color-dark">
            <button
              type="submit"
              className="rounded-lg bg-aws-sea-blue-light px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              disabled={!dirty || saving || !data?.configured}>
              {saving ? 'Saving…' : 'Save limits'}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={saving || !dirty}
              onClick={() => {
                setDirty(false);
                setFailure('');
                setMessage('');
                setRefreshVersion((version) => version + 1);
              }}>
              Discard changes
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={saving || dirty}
              onClick={() => setRefreshVersion((version) => version + 1)}>
              Reload saved limits
            </button>
            {dirty && <span className="text-xs">Unsaved changes</span>}
          </div>
          {message && (
            <p role="status" className="mt-3 text-sm">
              {message}
            </p>
          )}
          {failure && (
            <p role="alert" className="mt-3 text-sm text-red">
              {failure}
            </p>
          )}
        </form>
      )}
      <section className="my-6 rounded-2xl border border-gray/20 bg-white p-5 dark:bg-aws-ui-color-dark">
        <h2 className="text-lg font-semibold">Check current usage</h2>
        <form
          className="my-4 flex flex-wrap items-end gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setLoadingUsage(true);
            setUsageError('');
            try {
              const result = await http.getOnce<UsageSnapshot>(
                'admin/limits/usage',
                {
                  email: inspectEmail.trim() || userName,
                  model: inspectModel || models[0]?.[0],
                }
              );
              setUsage(result.data);
            } catch {
              setUsageError(
                'Could not load usage. Check the email and model, then retry.'
              );
            } finally {
              setLoadingUsage(false);
            }
          }}>
          <label className="min-w-0 flex-1 text-sm">
            Employee email (yours if blank)
            <input
              aria-label="Usage employee email"
              type="email"
              className={inputClass}
              value={inspectEmail}
              onChange={(e) => setInspectEmail(e.target.value)}
            />
          </label>
          <label className="min-w-0 text-sm">
            Model
            <select
              aria-label="Usage model"
              className={inputClass}
              value={inspectModel || models[0]?.[0] || ''}
              onChange={(e) => setInspectModel(e.target.value)}>
              {models.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            className={buttonClass}
            disabled={loadingUsage || models.length === 0}>
            {loadingUsage ? 'Loading…' : 'Check usage'}
          </button>
        </form>
        {usageError && <p role="alert">{usageError}</p>}
        {usage && <UsageSummary data={usage} />}
      </section>
    </div>
  );
}
