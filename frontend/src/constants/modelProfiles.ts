// Recommendations appear only for workspace-enabled models.
// Frontier candidates require a passing application-role check.
export const MODEL_PROFILES: Record<
  string,
  { label: string; description: string; rank: number }
> = {
  'claude-v5.5-sonnet': {
    label: 'Latest Sonnet',
    description: 'Coding, documents and everyday work.',
    rank: -5,
  },
  'gpt-6.2-sol': {
    label: 'Latest Sol',
    description: 'Everyday coding and business work.',
    rank: -4,
  },
  'claude-v5.5-opus': {
    label: 'Deep analysis',
    description:
      'Complex coding and knowledge work. Adaptive thinking is always active.',
    rank: -3,
  },
  'gpt-6.2-astra': {
    label: 'Complex projects',
    description: 'Careful reasoning, coding and longer technical work.',
    rank: -2,
  },
  'claude-v5.5-haiku': {
    label: 'Fast replies',
    description: 'Drafting, summaries and high-volume work.',
    rank: -1,
  },
  'amazon-nova-2-lite': {
    label: 'Fast alternative',
    description:
      'For summaries, drafting and extracted documents. Original PDFs still require Claude in this workspace.',
    rank: 4,
  },
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
