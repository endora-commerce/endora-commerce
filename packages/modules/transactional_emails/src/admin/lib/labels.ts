import type { EmailBlockSummary, ResolvedEmailContent, TransactionalEmailSummary } from '@endora-commerce/contracts';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import { defineEnumLabels, normalize } from '@endora-commerce/admin-kit/lib';

/**
 * Where an e-mail block or template applies, as the operator reads it (issue
 * #1463, UX audit CONTENT-05, under the pattern of #1434) — never the
 * `global` / `channel` code the API sends.
 */
export const emailScopeLabels = defineEnumLabels<EmailBlockSummary['scope']>({
  global: 'scope.global',
  channel: 'scope.channel',
});

/**
 * Where the content the editor shows comes from (issue #1536, UX audit
 * CONTENT-19) — never the `channel` / `global` / `default` code the API sends.
 */
export const emailSourceLabels = defineEnumLabels<ResolvedEmailContent['source']>({
  channel: 'source.channel',
  global: 'source.global',
  default: 'source.default',
});

/**
 * Whether an e-mail's content has been changed from the module's default, and
 * for which scope (issue #1536). The list used to print "Yes" or a dash.
 */
export type EmailCustomization = 'default' | 'all' | 'channels' | 'both';

export const emailCustomizationLabels = defineEnumLabels<EmailCustomization>({
  default: 'customization.default',
  all: 'customization.all',
  channels: 'customization.channels',
  both: 'customization.both',
});

export function customizationOf(
  email: Pick<TransactionalEmailSummary, 'hasGlobalOverride' | 'hasChannelOverride'>,
): EmailCustomization {
  if (email.hasGlobalOverride && email.hasChannelOverride) return 'both';
  if (email.hasGlobalOverride) return 'all';
  if (email.hasChannelOverride) return 'channels';
  return 'default';
}

/**
 * The name of the module that sends an e-mail, in the admin's language
 * (issue #1536). Read from that module's own bundle (`module.name`), which the
 * admin already holds for every module; English when the reader's language
 * has none; the id only when the module ships no name at all — an overlay
 * module, say. Reading the bundle directly rather than through `t()` keeps a
 * module without a name from reporting a missing key on every render.
 */
export function ownerModuleLabel(moduleId: string, bundle: Bundle, fallbackBundle?: Bundle): string {
  return bundle[moduleId]?.['module.name'] ?? fallbackBundle?.[moduleId]?.['module.name'] ?? moduleId;
}

/**
 * The rows the list shows for a search and a module filter (issue #1536). The
 * search matches the e-mail's name, its code and its module's name, so an
 * operator who thinks "the quote e-mails" finds them by typing either word.
 * `moduleLabel` is the same lookup the Module column renders.
 */
export function filterEmails(
  emails: readonly TransactionalEmailSummary[],
  filter: { q: string; module: string },
  moduleLabel: (moduleId: string) => string,
): TransactionalEmailSummary[] {
  const needle = normalize(filter.q);
  return emails.filter((email) => {
    if (filter.module !== '' && email.ownerModule !== filter.module) return false;
    if (!needle) return true;
    return [email.name, email.code, moduleLabel(email.ownerModule)].some((text) => normalize(text).includes(needle));
  });
}

/** One option per module that sends an e-mail in the list, sorted by its name. */
export function moduleOptions(
  emails: readonly TransactionalEmailSummary[],
  moduleLabel: (moduleId: string) => string,
): Array<{ value: string; label: string }> {
  const ids = [...new Set(emails.map((email) => email.ownerModule))];
  return ids
    .map((id) => ({ value: id, label: moduleLabel(id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * A sales channel's display name for the admin's language (issue #1536). The
 * admin language is a bare `en` / `pl` while a channel's names are keyed by
 * full locale (`en-US`, `pl-PL`): exact, then by language prefix, then
 * English, then any name the channel has, then its code.
 */
export function channelDisplayName(
  channel: { code: string; name: Record<string, string> },
  language: string,
): string {
  const { name } = channel;
  const byPrefix = Object.keys(name).find((locale) => locale.split('-')[0] === language);
  return (
    name[language] ??
    (byPrefix !== undefined ? name[byPrefix] : undefined) ??
    name['en-US'] ??
    name['en'] ??
    Object.values(name)[0] ??
    channel.code
  );
}
