import { BaseProps } from '../@types/common';
import useModel from '../hooks/useModel';
import { Popover, Transition } from '@headlessui/react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { PiCaretDown, PiCheck, PiMagnifyingGlass } from 'react-icons/pi';
import { ActiveModels } from '../@types/bot';
import { toCamelCase } from '../utils/StringUtils';
import { MODEL_PROFILES } from '../constants/modelProfiles';

interface Props extends BaseProps {
  activeModels: ActiveModels;
  botId?: string | null;
}
const SwitchBedrockModel: React.FC<Props> = (props) => {
  const {
    availableModels: allModels,
    modelId,
    setModelId,
    getDefaultModel,
  } = useModel(props.botId, props.activeModels);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const availableModels = useMemo(
    () =>
      allModels.filter(
        (model) =>
          !props.activeModels ||
          props.activeModels[
            toCamelCase(model.modelId) as keyof ActiveModels
          ] === true
      ),
    [allModels, props.activeModels]
  );
  useEffect(() => {
    if (
      !availableModels.some((model) => model.modelId === modelId) &&
      availableModels.length
    ) {
      const fallback = getDefaultModel();
      setModelId(
        availableModels.some((model) => model.modelId === fallback)
          ? fallback
          : availableModels[0].modelId
      );
    }
  }, [availableModels, modelId, setModelId, getDefaultModel]);
  const visibleModels = useMemo(() => {
    const query = search.trim().toLowerCase();
    return availableModels
      .filter(
        (model) =>
          (!query && !showAll
            ? Boolean(MODEL_PROFILES[model.modelId]) ||
              model.modelId === modelId
            : true) &&
          `${model.label} ${model.description} ${MODEL_PROFILES[model.modelId]?.description || ''}`
            .toLowerCase()
            .includes(query)
      )
      .sort(
        (a, b) =>
          (MODEL_PROFILES[a.modelId]?.rank ?? 100) -
          (MODEL_PROFILES[b.modelId]?.rank ?? 100)
      );
  }, [availableModels, modelId, search, showAll]);
  const selected = availableModels.find((model) => model.modelId === modelId);
  return (
    <Popover className="relative">
      {({ close }) => (
        <>
          <Popover.Button
            className={`${props.className ?? ''} inline-flex max-w-full items-center gap-2 rounded-xl border border-gray/30 bg-white px-4 py-2 text-left dark:bg-aws-ui-color-dark`}
            aria-label="Choose AI model">
            <div className="min-w-0">
              <div className="truncate font-semibold">
                {selected?.label || 'Choose a model'}
              </div>
              <div className="text-xs opacity-70">
                {MODEL_PROFILES[modelId]?.label || 'Workspace model'}
              </div>
            </div>
            <PiCaretDown className="shrink-0" />
          </Popover.Button>
          <Transition
            as={Fragment}
            enter="transition duration-100"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition duration-75"
            leaveFrom="opacity-100"
            leaveTo="opacity-0">
            <Popover.Panel className="absolute top-full left-0 z-20 mt-2 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-gray/30 bg-white shadow-xl dark:bg-aws-ui-color-dark">
              <div className="border-b border-gray/20 p-3">
                <div className="flex items-center gap-2 rounded-lg bg-light-gray/50 px-3 dark:bg-aws-paper-dark">
                  <PiMagnifyingGlass />
                  <input
                    autoFocus
                    aria-label="Search models"
                    placeholder="Search models or tasks…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
                  />
                </div>
                <p className="mt-2 text-xs opacity-70">
                  Choose by task. Deep reasoning can take longer.
                </p>
              </div>
              <div className="max-h-80 overflow-y-auto p-2">
                {visibleModels.map((model) => {
                  const profile = MODEL_PROFILES[model.modelId];
                  return (
                    <button
                      type="button"
                      key={model.modelId}
                      aria-pressed={model.modelId === modelId}
                      className="flex w-full items-start gap-3 rounded-xl p-3 text-left hover:bg-light-gray/50 dark:hover:bg-aws-paper-dark"
                      onClick={() => {
                        setModelId(model.modelId);
                        close();
                      }}>
                      <PiCheck
                        className={`mt-1 shrink-0 ${model.modelId === modelId ? '' : 'opacity-0'}`}
                      />
                      <div>
                        <div className="flex flex-wrap items-center gap-2 font-semibold">
                          {model.label}
                          {profile && (
                            <span className="rounded-full bg-light-gray px-2 py-0.5 text-[10px] font-medium dark:bg-aws-paper-dark">
                              {profile.label}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed opacity-75">
                          {profile?.description || model.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
                {!visibleModels.length && (
                  <p className="p-4 text-sm opacity-70">
                    No matching models in this workspace.
                  </p>
                )}
              </div>
              {!search && (
                <button
                  type="button"
                  className="w-full border-t border-gray/20 p-3 text-sm underline"
                  onClick={() => setShowAll(!showAll)}>
                  {showAll
                    ? 'Show recommended models'
                    : `Show all ${availableModels.length} workspace models`}
                </button>
              )}
            </Popover.Panel>
          </Transition>
        </>
      )}
    </Popover>
  );
};
export default SwitchBedrockModel;
