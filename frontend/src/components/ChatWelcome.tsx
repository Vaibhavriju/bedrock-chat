import {
  PiCode,
  PiFileText,
  PiLightbulb,
  PiSparkle,
  PiTrendUp,
} from 'react-icons/pi';

const starters = [
  {
    title: 'Understand a document',
    detail: 'Find the decisions, numbers and next steps.',
    icon: PiFileText,
    prompt:
      'Help me review a document. Once I attach it, summarize the key findings, identify uncertainties, and suggest next steps.',
  },
  {
    title: 'Review code',
    detail: 'Spot bugs and explain a better approach.',
    icon: PiCode,
    prompt:
      'Help me review code. Once I share the files, check correctness, edge cases, security and performance. Explain the most important issues first.',
  },
  {
    title: 'Explore an idea',
    detail: 'Turn a rough thought into a practical plan.',
    icon: PiLightbulb,
    prompt:
      'Help me turn an idea into a practical plan. Start by asking what outcome I want, who it is for, and what constraints we need to work within.',
  },
  {
    title: 'Make sense of data',
    detail: 'Compare trends and question assumptions.',
    icon: PiTrendUp,
    prompt:
      'Help me analyze data. Once I attach it, describe its structure, check for missing or inconsistent values, and ask what decision the analysis should support.',
  },
];

export default function ChatWelcome({
  title,
  description,
  onChoosePrompt,
}: {
  title?: string;
  description?: string;
  onChoosePrompt: (prompt: string) => void;
}) {
  return (
    <div className="workspace-welcome w-full max-w-2xl text-center">
      <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-2xl bg-aws-sea-blue-light/10 text-2xl text-aws-sea-blue-light dark:text-aws-sea-blue-dark">
        <PiSparkle aria-hidden="true" />
      </div>
      <p className="mb-3 text-sm font-medium text-aws-sea-blue-light dark:text-aws-sea-blue-dark">
        BATTERYPOOL WORKSPACE
      </p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {title || 'What are we working on?'}
      </h1>
      <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed opacity-65">
        {description ||
          'A place to think, build and get work done. Ask a question or bring your documents and code.'}
      </p>
      {!title && (
        <div className="mt-8 grid grid-cols-1 gap-3 text-left sm:grid-cols-2">
          {starters.map(
            ({ title: starterTitle, detail, icon: Icon, prompt }) => (
              <button
                key={starterTitle}
                type="button"
                className="workspace-starter flex items-start gap-3 rounded-2xl border border-gray/15 bg-white p-4 text-left transition-colors hover:border-aws-sea-blue-light/40 hover:bg-aws-sea-blue-light/5 dark:bg-aws-ui-color-dark"
                onClick={() => onChoosePrompt(prompt)}>
                <Icon
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-xl text-aws-sea-blue-light dark:text-aws-sea-blue-dark"
                />
                <span>
                  <span className="block text-sm font-semibold">
                    {starterTitle}
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed opacity-65">
                    {detail}
                  </span>
                </span>
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
