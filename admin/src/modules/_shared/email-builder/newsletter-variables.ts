import type { EmailVariableDescriptor } from '@b2b/contracts';

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

export const NEWSLETTER_BASE_VARIABLES: EmailVariableItem[] = [
  {
    key: 'subscriber.email',
    label: 'Subscriber email',
    sampleValue: 'ada@example.com',
  },
  {
    key: 'unsubscribeUrl',
    label: 'Unsubscribe URL',
    description: 'One-click unsubscribe link for this send',
    sampleValue: 'https://shop.example/newsletter/unsubscribe?token=…',
  },
  {
    key: 'webviewUrl',
    label: 'Web view URL',
    description: 'Browser view of this email (when available)',
    sampleValue: 'https://shop.example/newsletter/view/…',
  },
  {
    key: 'channel.id',
    label: 'Sales channel id',
    sampleValue: '00000000-0000-0000-0000-000000000001',
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

export function newsletterVariables(
  customFieldKeys: readonly { key: string; label: string }[] = [],
): EmailVariableItem[] {
  const custom: EmailVariableItem[] = customFieldKeys.map((f) => ({
    key: `customFields.${f.key}`,
    label: f.label || f.key,
    description: 'Newsletter custom field',
  }));
  return mergeEmailVariables([], [...NEWSLETTER_BASE_VARIABLES, ...custom]);
}
