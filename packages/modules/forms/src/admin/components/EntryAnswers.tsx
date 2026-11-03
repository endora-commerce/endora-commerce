import { useId, type ReactNode } from 'react';
import type { FormEntryDetail } from '@endora-commerce/contracts';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@endora-commerce/admin-kit/ui';

/**
 * What an entry says (`specs/170-forms-module/` US4-2, US1-6, FR-029): its answers in the labels and
 * order of the version it was sent to — a field renamed or removed since shows as the shopper saw
 * it — its consents with the texts shown, and the context it was sent in: the page, the language,
 * the channel, the time, the form's version and who sent it.
 *
 * Everything is text: a consent's shown text is HTML the module stored, and it is shown here
 * stripped of its markup rather than rendered, so nothing a shopper typed is ever markup here.
 */

type Answer = FormEntryDetail['answers'][number];

/** Markup removed, whitespace collapsed. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function answerText(answer: Answer, yes: string, no: string): string {
  const { value } = answer;
  if (typeof value === 'boolean') return value ? yes : no;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object' && value !== null) {
    const town = [value.postalCode, value.city].filter((part) => part && part.trim() !== '').join(' ');
    return [value.street, value.line2, town, value.country].filter((part) => part && part.trim() !== '').join(', ');
  }
  return value;
}

function Region({ titleKey, children }: { readonly titleKey: string; readonly children: ReactNode }): ReactNode {
  const t = useTranslation('forms');
  const titleId = useId();
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader className="p-4 pb-2">
        <CardTitle>
          <h2 id={titleId}>{t(titleKey)}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">{children}</CardContent>
    </Card>
  );
}

export function EntryAnswers({ entry }: { readonly entry: FormEntryDetail }): ReactNode {
  const t = useTranslation('forms');
  return (
    <Region titleKey="entry.answers">
      {entry.answers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('entry.noAnswers')}</p>
      ) : (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(10rem,14rem)_1fr]">
          {entry.answers.map((answer) => (
            <div key={answer.fieldKey} className="contents">
              <dt className="text-sm font-medium text-muted-foreground">{answer.label}</dt>
              <dd className="whitespace-pre-wrap break-words text-sm">{answerText(answer, t('entry.yes'), t('entry.no'))}</dd>
            </div>
          ))}
        </dl>
      )}
    </Region>
  );
}

export function EntryConsents({ entry }: { readonly entry: FormEntryDetail }): ReactNode {
  const t = useTranslation('forms');
  if (entry.consents.length === 0) return null;
  return (
    <Region titleKey="entry.consents">
      <ul className="space-y-2">
        {entry.consents.map((consent) => (
          <li key={consent.fieldKey} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span>{plainText(consent.text)}</span>
            <span className="font-medium">{consent.given ? t('entry.consentGiven') : t('entry.consentRefused')}</span>
          </li>
        ))}
      </ul>
    </Region>
  );
}

export function EntryContext({
  entry,
  channelName,
}: {
  readonly entry: FormEntryDetail;
  /** The channel's name, when the reader may list channels; its id otherwise. */
  readonly channelName: string | null;
}): ReactNode {
  const t = useTranslation('forms');
  const { language } = useAppLanguage();
  const time = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
  const rows: [string, ReactNode][] = [
    ['entry.submittedAt', time.format(new Date(entry.submittedAt))],
    ['entry.page', entry.pageUrl ? <span className="break-all">{entry.pageUrl}</span> : '—'],
    ['entry.language', entry.language],
    ['entry.channel', channelName ?? entry.salesChannelId],
    ['entry.version', String(entry.formVersion)],
    [
      'entry.attribution',
      entry.customerAccountId ? (
        <span className="space-y-0.5">
          <span className="block">{t('entry.customer', { id: entry.customerAccountId })}</span>
          {entry.organizationId ? <span className="block">{t('entry.organization', { id: entry.organizationId })}</span> : null}
        </span>
      ) : (
        t('entry.anonymous')
      ),
    ],
  ];
  return (
    <Region titleKey="entry.context">
      <dl className="space-y-2 text-sm">
        {rows.map(([key, value]) => (
          <div key={key} className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">{t(key)}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </Region>
  );
}
