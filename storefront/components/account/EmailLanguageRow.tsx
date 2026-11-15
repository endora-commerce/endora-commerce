import type { ReactElement } from 'react';
import { scopeLanguageOf } from '@endora-commerce/contracts';
import { tForLocale } from '../../lib/i18n/messages';
import { format } from '../../lib/i18n/format';

/**
 * The account page's "E-mail language" row (issue #652, D-292).
 *
 * The language the platform writes this buyer's e-mails in. The account
 * records one from the first page it was created or signed in on; this row is
 * the one place the buyer changes it. Offered: the channel's own languages,
 * each named in its own language (as the header's language switcher names
 * them). Preselected: the language the e-mails are actually sent in — the
 * stored one resolved against this channel (`scopeLanguageOf`), so a language
 * the channel does not offer shows the channel's fallback, with a note saying
 * so.
 *
 * Read-only text, not a control, when there is nothing to choose (a
 * single-language channel) or nowhere to save it (`customers` off). Saved by
 * a server action that redirects back with `?languageSaved=1` or
 * `?languageError=1`, like the push preferences below it, so it works without
 * JavaScript; the outcome is announced in a live region.
 */
export interface EmailLanguageRowProps {
  locale: string;
  /** The channel's languages, in its own spelling and order. */
  languages: readonly string[];
  defaultLanguage: string;
  /** The account's stored language, or `null` while unknown. */
  preferredLanguage: string | null;
  /** A language's name in that language (the dictionary's `nativeLabel`). */
  labelOf: (code: string) => string;
  /** Whether the choice can be saved here — `customers` is present. */
  editable: boolean;
  saveAction: (formData: FormData) => Promise<void>;
  saved: boolean;
  failed: boolean;
}

const SELECT_ID = 'b2b-email-language';
const HINT_ID = 'b2b-email-language-hint';

export function EmailLanguageRow(props: EmailLanguageRowProps): ReactElement {
  const t = tForLocale(props.locale);
  const resolved = scopeLanguageOf(
    { id: 'storefront', languages: props.languages, defaultLanguage: props.defaultLanguage },
    props.preferredLanguage,
  );
  const stored = props.preferredLanguage;
  const notOffered =
    stored !== null && !props.languages.some((language) => language.toLowerCase() === stored.toLowerCase());
  const offered = props.languages.includes(resolved) ? props.languages : [resolved, ...props.languages];
  const choosable = props.editable && offered.length > 1;
  const note = notOffered ? (
    <p className="b2b-auth__hint">
      {format(t('account.profile.emailLanguageNotOffered'), {
        language: props.labelOf(stored),
        fallback: props.labelOf(resolved),
      })}
    </p>
  ) : null;

  if (!choosable) {
    return (
      <tr>
        <th scope="row">{t('account.profile.emailLanguage')}</th>
        <td>
          {props.labelOf(resolved)}
          {note}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <th scope="row">
        <label htmlFor={SELECT_ID}>{t('account.profile.emailLanguage')}</label>
      </th>
      <td>
        <form action={props.saveAction} className="flex flex-wrap items-center gap-2">
          <select
            id={SELECT_ID}
            name="preferredLanguage"
            className="industria-select"
            defaultValue={resolved}
            aria-describedby={HINT_ID}
          >
            {offered.map((code) => (
              <option key={code} value={code} lang={code}>
                {props.labelOf(code)}
              </option>
            ))}
          </select>
          <button type="submit" className="btn">
            {t('account.profile.emailLanguageSave')}
          </button>
        </form>
        <p id={HINT_ID} className="b2b-auth__hint">
          {t('account.profile.emailLanguageHint')}
        </p>
        {note}
        <div aria-live="polite">
          {props.saved ? (
            <p className="b2b-auth__success" role="status">
              {t('account.profile.emailLanguageSaved')}
            </p>
          ) : null}
        </div>
        {props.failed ? (
          <p className="b2b-auth__error" role="alert">
            {t('account.profile.emailLanguageError')}
          </p>
        ) : null}
      </td>
    </tr>
  );
}

/** The language the row's form submitted, or `null` when it carried none. */
export function emailLanguageFromForm(formData: FormData): string | null {
  const value = formData.get('preferredLanguage');
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
