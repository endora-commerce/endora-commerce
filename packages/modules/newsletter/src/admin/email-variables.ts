import {
  mergeEmailVariables,
  type EmailVariableItem,
} from '@endora-commerce/page-builder-admin/email';

/**
 * `newsletter`'s own e-mail variable vocabulary (feature 091, P5b;
 * `admin-component-contribution.md` Z1.2).
 *
 * It lived in `admin/src/modules/_shared/email-builder/newsletter-variables.ts`
 * until the e-mail builder became `@endora-commerce/page-builder-admin`. A
 * subscriber's e-mail address, an unsubscribe URL, a web-view URL and a
 * newsletter custom field are one module's domain vocabulary, and all three
 * consumers are this module's own screens — so it exits into `newsletter`
 * rather than being published from a package that would then know what a
 * subscriber is. The generic half (the branding pair, the `if`/`for` snippets
 * and `mergeEmailVariables`) stays in the package, where every e-mail builder
 * needs it whichever module opened one.
 */
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
