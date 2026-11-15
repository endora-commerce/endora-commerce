import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  EmailLanguageRow,
  emailLanguageFromForm,
  type EmailLanguageRowProps,
} from '../../components/account/EmailLanguageRow';

/**
 * Issue #652 (D-292) — the account page's "E-mail language" row.
 *
 * A labelled select of the channel's languages, named in their own language,
 * with the resolved language preselected and a Save that posts a server action
 * (redirect-after-POST, `?languageSaved=1` / `?languageError=1`). On a
 * single-language channel, or while `customers` is off, the row stays and only
 * says which language is used. A stored language the channel does not offer is
 * explained, and the language its e-mails fall back to is the one preselected.
 */

async function noop(): Promise<void> {}

const LABELS: Record<string, string> = { 'pl-PL': 'Polski', 'en-US': 'English', 'de-DE': 'Deutsch' };

function render(overrides: Partial<EmailLanguageRowProps> = {}): string {
  return renderToString(
    <table>
      <tbody>
        <EmailLanguageRow
          locale="en-US"
          languages={['pl-PL', 'en-US']}
          defaultLanguage="pl-PL"
          preferredLanguage="en-US"
          labelOf={(code) => LABELS[code] ?? code}
          editable
          saveAction={noop}
          saved={false}
          failed={false}
          {...overrides}
        />
      </tbody>
    </table>,
  );
}

describe('the e-mail language row (#652)', () => {
  it('offers the channel languages by their native names, the stored one selected, under a visible label', () => {
    const html = render();
    expect(html).toContain('<label for="b2b-email-language">E-mail language</label>');
    expect(html).toMatch(/<select[^>]*id="b2b-email-language"[^>]*name="preferredLanguage"/);
    expect(html).toMatch(/<option value="pl-PL"[^>]*>Polski<\/option>/);
    expect(html).toMatch(/<option value="en-US"[^>]*selected=""[^>]*>English<\/option>/);
    expect(html).toContain('aria-describedby="b2b-email-language-hint"');
    expect(html).toContain('E-mails about your orders, returns, invoices and approvals are written in this language.');
    expect(html).toContain('>Save</button>');
  });

  it('preselects the channel default when no language is known', () => {
    const html = render({ preferredLanguage: null });
    expect(html).toMatch(/<option value="pl-PL"[^>]*selected=""/);
    expect(html).not.toContain('does not offer');
  });

  it('explains a stored language the channel does not offer and preselects the fallback', () => {
    const html = render({ preferredLanguage: 'de-DE' });
    expect(html).toContain('This store does not offer your e-mail language (Deutsch), so its e-mails are sent in Polski.');
    expect(html).toMatch(/<option value="pl-PL"[^>]*selected=""/);
    expect(html).not.toContain('value="de-DE"');
  });

  it('is read-only text on a single-language channel', () => {
    const html = render({ languages: ['pl-PL'], preferredLanguage: null });
    expect(html).toContain('E-mail language');
    expect(html).toContain('Polski');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<form');
  });

  it('keeps the row read-only while customers is off', () => {
    const html = render({ editable: false });
    expect(html).toContain('English');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<form');
  });

  it('announces a save in a live region and a failure as an alert', () => {
    expect(render({ saved: true })).toMatch(/role="status"[^>]*>E-mail language saved\.</);
    expect(render({ failed: true })).toMatch(
      /role="alert"[^>]*>The e-mail language could not be saved\. Try again\.</,
    );
  });

  it('speaks Polish on a Polish page', () => {
    const html = render({ locale: 'pl-PL', saved: true });
    expect(html).toContain('Język wiadomości e-mail');
    expect(html).toContain('>Zapisz</button>');
    expect(html).toContain('Zapisano język wiadomości e-mail.');
  });
});

describe('emailLanguageFromForm', () => {
  it('reads the submitted language, trimmed', () => {
    const form = new FormData();
    form.set('preferredLanguage', ' en-US ');
    expect(emailLanguageFromForm(form)).toBe('en-US');
  });

  it('answers null for a form without one', () => {
    expect(emailLanguageFromForm(new FormData())).toBeNull();
  });
});
