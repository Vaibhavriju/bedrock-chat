// Recommendations use models AWS Support confirmed for this workspace.
// The administrator's configured model list remains authoritative.
export const MODEL_PROFILES: Record<
  string,
  { label: string; description: string; rank: number }
> = {
  'claude-v4.6-sonnet': {
    label: 'Everyday & coding',
    description:
      'Default for code review, documents, analysis and everyday work. Enable reasoning when a problem needs more thought.',
    rank: 0,
  },
  'claude-v4.6-opus': {
    label: 'Complex problems',
    description:
      'Choose for architecture, difficult debugging and careful reasoning. Usually takes longer than Sonnet.',
    rank: 1,
  },
  'claude-v4.5-haiku': {
    label: 'Fast replies',
    description:
      'Quick drafting, summaries and straightforward questions when response time matters most.',
    rank: 2,
  },
  'claude-v4.5-sonnet': {
    label: 'Alternative',
    description: 'An alternative for everyday tasks and coding.',
    rank: 3,
  },
};
