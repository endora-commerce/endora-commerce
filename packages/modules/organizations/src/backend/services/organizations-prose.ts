import type { SupportedLanguage } from '@endora-commerce/contracts';

/**
 * The prose this module's backend composes for a reader whose language it
 * knows — a fallback e-mail, a sentence returned on a storefront request
 * (`specs/conventions/module-i18n.md`, the case where the backend can resolve
 * the reader's language). The sentences live in this module's bundle; this file
 * keeps their English beside the code as the last tier, for when the bundle
 * cannot answer — a bundle the boot reconciler skipped, or a translator that
 * was not wired. `organizations-prose.test.ts` holds it equal to `i18n/en.json`.
 */
export const ORGANIZATIONS_PROSE_EN = {
  'notifications.newRegistration.title': 'New organization: {name}',
  'notifications.newRegistration.body.pending': 'Awaiting verification.',
  'notifications.newRegistration.body.active': 'Registered automatically.',
  'notifications.newRegistration.status.pending': 'Awaiting verification',
  'notifications.newRegistration.status.active': 'Active',
  'notifications.newRegistration.email.body':
    'A new organization has registered on the B2B platform.\n\n' +
    '  Name:    {name}\n' +
    '  Tax ID:  {taxId}\n' +
    '  Status:  {status}\n\n' +
    'Open in the admin panel: {linkPath}',
} as const;

export type OrganizationsProseKey = keyof typeof ORGANIZATIONS_PROSE_EN;

export type ProseParams = Record<string, string | number>;

/**
 * `_i18n`'s `adminI18nService.translate`, bound to this module's bundle. It
 * answers `organizations.<key>` for a key no bundle carries.
 */
export type OrganizationsTranslate = (
  key: string,
  language: SupportedLanguage,
  params?: ProseParams,
) => Promise<string>;

/** One sentence of this module's prose in `language`, English when the bundle cannot answer. */
export async function organizationsProse(
  translate: OrganizationsTranslate | undefined,
  key: OrganizationsProseKey,
  language: SupportedLanguage,
  params?: ProseParams,
): Promise<string> {
  if (translate) {
    try {
      const text = await translate(key, language, params);
      if (text !== `organizations.${key}`) return text;
    } catch {
      // The English tier below is the answer to an unreachable bundle.
    }
  }
  return fillPlaceholders(ORGANIZATIONS_PROSE_EN[key], params);
}

function fillPlaceholders(template: string, params?: ProseParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] != null ? String(params[name]) : match,
  );
}
