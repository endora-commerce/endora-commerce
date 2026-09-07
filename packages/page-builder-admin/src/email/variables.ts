/**
 * The e-mail builder's own variable vocabulary — the part that belongs to no
 * module (feature 091, P5b; `admin-component-contribution.md` Z1.2).
 *
 * `newsletterVariables` and `NEWSLETTER_BASE_VARIABLES` are **not** here: a
 * subscriber e-mail, an unsubscribe URL and a web-view URL are `newsletter`'s
 * domain vocabulary, all three of their consumers are `newsletter`'s own
 * screens, and they live in `admin/src/modules/newsletter/email-variables.ts`.
 * What stays is what any e-mail builder needs whichever module opened it: the
 * branding pair the preview resolves, the two template snippets, and the merge.
 */
import type { EmailVariableDescriptor } from '@endora-commerce/contracts';

export interface EmailVariableItem extends EmailVariableDescriptor {
  /** When set, insert this instead of `{{var key}}` (e.g. if/for snippets). */
  snippet?: string;
}

export const BRANDING_VARIABLES: EmailVariableItem[] = [
  {
    key: 'branding.logoUrl',
    label: 'Brand logo URL',
    description: 'Resolved header logo for the current sales channel',
    sampleValue: 'https://cdn.example/logo.png',
  },
  {
    key: 'branding.accentColor',
    label: 'Brand accent color',
    description: 'Accent color used by buttons and highlights',
    sampleValue: '#1f2937',
  },
];

export const COMMON_SNIPPETS: EmailVariableItem[] = [
  {
    key: 'snippet.if',
    label: 'If block',
    description: 'Conditional section',
    snippet: '{{if path}}\n…\n{{/if}}',
  },
  {
    key: 'snippet.for',
    label: 'For loop',
    description: 'Iterate a list (e.g. order.items)',
    snippet: '{{for item in order.items}}\n{{var item.name}}\n{{/for}}',
  },
];

export function mergeEmailVariables(
  declared: readonly EmailVariableDescriptor[] | undefined,
  extras: readonly EmailVariableItem[] = [],
): EmailVariableItem[] {
  const byKey = new Map<string, EmailVariableItem>();
  for (const v of BRANDING_VARIABLES) byKey.set(v.key, v);
  for (const v of declared ?? []) byKey.set(v.key, { ...v });
  for (const v of extras) byKey.set(v.key, v);
  for (const v of COMMON_SNIPPETS) byKey.set(v.key, v);
  return [...byKey.values()];
}
