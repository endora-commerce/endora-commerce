import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { OrganizationModerationBanner } from '../../components/OrganizationModerationBanner';

/**
 * Issue #85: the banner's title was a Polish literal per status, so a buyer of
 * an English shop whose organization was awaiting verification read the
 * heading in Polish above the (server-localized) message in English. The title
 * is a catalogue key now; the message is still the one `GET /me` answered.
 */
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

function render(status: string, locale: string): string {
  return renderToString(
    <OrganizationModerationBanner status={status} message="server message" locale={locale} />,
  );
}

const TITLES = [
  {
    status: 'pending_verification',
    en: 'Your organization is awaiting verification',
    pl: 'Twoja Organizacja oczekuje na weryfikację',
  },
  { status: 'blocked', en: 'Ordering is suspended', pl: 'Składanie Zamówień jest wstrzymane' },
  {
    status: 'rejected',
    en: 'Your organization’s registration was rejected',
    pl: 'Rejestracja Twojej Organizacji została odrzucona',
  },
  {
    status: 'some_future_status',
    en: 'Ordering is currently unavailable',
    pl: 'Składanie Zamówień obecnie niedostępne',
  },
] as const;

describe('OrganizationModerationBanner speaks the page language', () => {
  for (const { status, en, pl } of TITLES) {
    it(`titles ${status} in English for an English shop`, () => {
      const html = render(status, 'en-US');
      expect(html).toContain(`>${en}<`);
      expect(html).not.toMatch(POLISH);
      expect(html).toContain('server message');
    });

    it(`titles ${status} in Polish for a Polish shop`, () => {
      const html = render(status, 'pl-PL');
      expect(html).toContain(`>${pl}<`);
      expect(html).not.toContain(en);
    });
  }

  it('renders nothing for an active organization, in either language', () => {
    expect(render('active', 'en-US')).toBe('');
    expect(render('active', 'pl-PL')).toBe('');
  });
});
