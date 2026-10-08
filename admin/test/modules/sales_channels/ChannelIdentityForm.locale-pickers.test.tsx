import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SalesChannelDetail } from '@endora-commerce/contracts';
import { TranslationProvider } from '../../../../packages/admin-shell/src/i18n/TranslationProvider';
import type { Bundle } from '../../../../packages/admin-shell/src/i18n/types';

/**
 * The language and currency controls of the Sales Channel create / edit form.
 *
 * - **Languages** and **Currencies** are searchable multi-selects: a combobox
 *   filtered as the operator types, the selection shown as removable chips.
 * - **Default language** and **Default currency** are searchable single
 *   selects offering only what the multi-select beside them currently holds.
 *
 * The claim this file exists for is the third one: **a default that leaves the
 * selected set is cleared and reported, never silently replaced.** The form used
 * to re-point the default at whichever entry happened to be first in the list,
 * which changes what a storefront serves at `/` without the operator having
 * chosen it.
 *
 * The Dictionary is about to hold a couple of hundred languages, so the fixture
 * below is that size rather than two rows.
 */

interface DictionaryRow {
  code: string;
  label: string;
  nativeLabel?: string;
  isActive: boolean;
}

const LANGUAGES: DictionaryRow[] = [
  { code: 'en-US', label: 'English (United States)', nativeLabel: 'English', isActive: true },
  { code: 'pl-PL', label: 'Polish', nativeLabel: 'Polski', isActive: true },
  { code: 'de-DE', label: 'German', nativeLabel: 'Deutsch', isActive: true },
  { code: 'cs-CZ', label: 'Czech', nativeLabel: 'Čeština', isActive: true },
  { code: 'la-VA', label: 'Latin', nativeLabel: 'Latina', isActive: false },
  ...Array.from({ length: 180 }, (_, i) => ({
    code: `x${String(i).padStart(3, '0')}-ZZ`,
    label: `Filler language ${i}`,
    nativeLabel: `Filler ${i}`,
    isActive: true,
  })),
];

const CURRENCIES: DictionaryRow[] = [
  { code: 'PLN', label: 'Polish złoty', isActive: true },
  { code: 'EUR', label: 'Euro', isActive: true },
  { code: 'USD', label: 'US dollar', isActive: true },
  { code: 'DEM', label: 'Deutsche Mark', isActive: false },
];

/**
 * What the next dictionary request answers. `apiClient` is the seam — see the
 * note in `ChannelIdentityForm.theme.test.tsx` on why the mock is keyed on the
 * package specifier and not on the `@/lib` shim.
 */
const dictionary: {
  respond: (url: string) => Promise<{ data: DictionaryRow[] }>;
  requests: string[];
} = {
  respond: async () => ({ data: [] }),
  requests: [],
};

function answerFromFixtures(url: string): Promise<{ data: DictionaryRow[] }> {
  if (url.startsWith('/api/v1/admin/dictionary/languages')) return Promise.resolve({ data: LANGUAGES });
  if (url.startsWith('/api/v1/admin/dictionary/currencies')) return Promise.resolve({ data: CURRENCIES });
  return Promise.reject(new Error(`unexpected request: ${url}`));
}

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      get: (url: string) => {
        dictionary.requests.push(url);
        return dictionary.respond(url);
      },
    },
  };
});

const { ChannelIdentityForm } = await import(
  '../../../../packages/modules/sales_channels/src/admin/components/ChannelIdentityForm'
);
type FormValue = import(
  '../../../../packages/modules/sales_channels/src/admin/components/ChannelIdentityForm'
).ChannelIdentityFormValue;

const REPO_ROOT = resolve(process.cwd(), '..');

function readBundle(module: string, language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages/modules', module, 'i18n', `${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

const en = readBundle('sales_channels', 'en');
const pl = readBundle('sales_channels', 'pl');

/** The shipped bundles, so a missing key shows up as a raw key and fails. */
function bundle(language: 'en' | 'pl'): Bundle {
  return { sales_channels: readBundle('sales_channels', language), core: readBundle('_i18n', language) };
}

function channel(overrides: Partial<SalesChannelDetail> = {}): SalesChannelDetail {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    code: 'pl_retail',
    name: { 'en-US': 'PL retail' },
    active: true,
    systemDefault: false,
    defaultLanguage: 'pl-PL',
    defaultCurrency: 'PLN',
    themeCode: null,
    logoAssetId: null,
    version: 3,
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
    languages: ['pl-PL', 'en-US'],
    currencies: ['PLN', 'EUR'],
    logoUrl: null,
    ...overrides,
  };
}

interface Rendered {
  submitted: FormValue[];
  container: HTMLElement;
}

async function renderForm(
  props: { initial?: SalesChannelDetail; mode?: 'create' | 'edit'; language?: 'en' | 'pl' } = {},
): Promise<Rendered> {
  const submitted: FormValue[] = [];
  const language = props.language ?? 'en';
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <TranslationProvider language={language} initialBundle={bundle(language)}>
      <>{children}</>
    </TranslationProvider>
  );
  const { container } = render(
    <ChannelIdentityForm
      mode={props.mode ?? (props.initial ? 'edit' : 'create')}
      initial={props.initial ?? null}
      onSubmit={(value: FormValue) => {
        submitted.push(value);
      }}
    />,
    { wrapper },
  );
  // Let the two dictionary requests settle, whichever way they answer.
  await waitFor(() => {
    expect(field('sc-languages').getAttribute('aria-busy')).not.toBe('true');
  });
  return { submitted, container };
}

function field(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  expect(el, `no element #${id}`).not.toBeNull();
  return el as HTMLInputElement;
}

/** The option values a combobox offers right now. */
function offered(id: string, query?: string): string[] {
  const el = field(id);
  fireEvent.focus(el);
  if (query !== undefined) fireEvent.change(el, { target: { value: query } });
  const listbox = document.getElementById(el.getAttribute('aria-controls')!)!;
  const values = within(listbox)
    .queryAllByRole('option')
    .map((option) => option.getAttribute('data-value') ?? option.textContent ?? '');
  fireEvent.keyDown(el, { key: 'Escape' });
  return values;
}

/** Chips of a multi-select, in order. */
function chips(id: string): string[] {
  const root = field(id).closest('[data-multi-combobox]')!;
  return Array.from(root.querySelectorAll('[data-chip-value]')).map(
    (el) => el.getAttribute('data-chip-value') ?? '',
  );
}

function pick(id: string, query: string): void {
  const el = field(id);
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value: query } });
  fireEvent.keyDown(el, { key: 'Enter' });
  fireEvent.keyDown(el, { key: 'Escape' });
}

function removeChip(name: RegExp): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

function submit(): void {
  fireEvent.submit(field('sc-code').closest('form')!);
}

function submitButton(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

/** The text of whatever the field's `aria-describedby` points at. */
function describedBy(id: string): string {
  return (field(id).getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((ref) => document.getElementById(ref)?.textContent ?? '')
    .join(' ');
}

beforeEach(() => {
  dictionary.respond = answerFromFixtures;
  dictionary.requests = [];
});

describe('the four controls', () => {
  it('are comboboxes, each named by its visible label', async () => {
    await renderForm({ initial: channel() });
    for (const [id, name] of [
      ['sc-languages', 'Languages'],
      ['sc-default-lang', 'Default language'],
      ['sc-currencies', 'Currencies'],
      ['sc-default-curr', 'Default currency'],
    ] as const) {
      const el = field(id);
      expect(el.getAttribute('role'), id).toBe('combobox');
      expect(screen.getByRole('combobox', { name }), id).toBe(el);
    }
  });

  it('show the stored selection as chips and the stored defaults as text', async () => {
    await renderForm({ initial: channel() });
    expect(chips('sc-languages')).toEqual(['pl-PL', 'en-US']);
    expect(chips('sc-currencies')).toEqual(['PLN', 'EUR']);
    expect(field('sc-default-lang').value).toBe('pl-PL — Polish');
    expect(field('sc-default-curr').value).toBe('PLN — Polish złoty');
  });

  it('render no raw translation key, in either language', async () => {
    for (const language of ['en', 'pl'] as const) {
      const { container } = await renderForm({ initial: channel(), language });
      fireEvent.focus(field('sc-languages'));
      expect(container.innerHTML).not.toMatch(/\b(?:core|sales_channels)\.[a-zA-Z]/);
      document.body.innerHTML = '';
    }
  });
});

describe('the Languages and Currencies multi-selects', () => {
  it('offer every active Dictionary entry, and an inactive one only while it is selected', async () => {
    await renderForm({ initial: channel() });
    const languages = offered('sc-languages');
    expect(languages).toHaveLength(LANGUAGES.filter((row) => row.isActive).length);
    expect(languages).not.toContain('la-VA');
    expect(offered('sc-currencies')).toEqual(['PLN', 'EUR', 'USD']);
  });

  it('keep an inactive stored entry visible, and marked, until it is removed', async () => {
    await renderForm({ initial: channel({ currencies: ['PLN', 'DEM'] }) });
    expect(chips('sc-currencies')).toEqual(['PLN', 'DEM']);
    expect(offered('sc-currencies')).toContain('DEM');
    expect(screen.getByRole('button', { name: /Remove DEM — Deutsche Mark \(inactive\)/ })).toBeTruthy();
  });

  it('find a language by its code', async () => {
    await renderForm();
    expect(offered('sc-languages', 'cs-c')).toEqual(['cs-CZ']);
  });

  it('find a language by its name, and by its own name for itself, without diacritics', async () => {
    await renderForm();
    expect(offered('sc-languages', 'german')).toEqual(['de-DE']);
    expect(offered('sc-languages', 'cestina')).toEqual(['cs-CZ']);
  });

  it('find a currency by its code and by its name', async () => {
    await renderForm();
    expect(offered('sc-currencies', 'eur')).toEqual(['EUR']);
    expect(offered('sc-currencies', 'zloty')).toEqual(['PLN']);
  });

  it('say so when nothing matches', async () => {
    await renderForm();
    const el = field('sc-languages');
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: 'klingon' } });
    const listbox = document.getElementById(el.getAttribute('aria-controls')!)!;
    expect(within(listbox).queryAllByRole('option')).toEqual([]);
    expect(listbox.textContent).toBe(en['identity.languages.noMatches']);
  });

  it('add what is picked and submit it in the order it was picked', async () => {
    const { submitted } = await renderForm({ initial: channel() });
    pick('sc-languages', 'german');
    pick('sc-currencies', 'usd');
    expect(chips('sc-languages')).toEqual(['pl-PL', 'en-US', 'de-DE']);
    submit();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.languages).toEqual(['pl-PL', 'en-US', 'de-DE']);
    expect(submitted[0]!.currencies).toEqual(['PLN', 'EUR', 'USD']);
  });
});

describe('the Default language and Default currency selects', () => {
  it('offer only what is currently selected beside them', async () => {
    await renderForm({ initial: channel() });
    expect(offered('sc-default-lang')).toEqual(['pl-PL', 'en-US']);
    expect(offered('sc-default-curr')).toEqual(['PLN', 'EUR']);
    pick('sc-languages', 'german');
    expect(offered('sc-default-lang')).toEqual(['pl-PL', 'en-US', 'de-DE']);
  });

  it('are searchable by code and by name', async () => {
    await renderForm({ initial: channel() });
    expect(offered('sc-default-lang', 'en-')).toEqual(['en-US']);
    expect(offered('sc-default-lang', 'polski')).toEqual(['pl-PL']);
    expect(offered('sc-default-curr', 'euro')).toEqual(['EUR']);
  });

  it('change the default when another selected entry is picked', async () => {
    const { submitted } = await renderForm({ initial: channel() });
    pick('sc-default-lang', 'english');
    pick('sc-default-curr', 'eur');
    submit();
    expect(submitted[0]!.defaultLanguage).toBe('en-US');
    expect(submitted[0]!.defaultCurrency).toBe('EUR');
  });

  it('cannot be emptied by Backspace — a channel always has a default', async () => {
    await renderForm({ initial: channel() });
    const el = field('sc-default-lang');
    fireEvent.focus(el);
    fireEvent.keyDown(el, { key: 'Backspace' });
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(el.value).toBe('pl-PL — Polish');
  });
});

describe('removing the entry that is the current default', () => {
  it('clears the default language instead of re-pointing it', async () => {
    await renderForm({ initial: channel() });
    removeChip(/^Remove pl-PL/);
    expect(chips('sc-languages')).toEqual(['en-US']);
    // Not 'en-US — …': the form used to promote whatever was first in the list.
    expect(field('sc-default-lang').value).toBe('');
  });

  it('reports it on the field, linked for assistive technology', async () => {
    await renderForm({ initial: channel() });
    expect(field('sc-default-lang').hasAttribute('aria-invalid')).toBe(false);
    removeChip(/^Remove pl-PL/);
    expect(field('sc-default-lang').getAttribute('aria-invalid')).toBe('true');
    expect(describedBy('sc-default-lang')).toContain(en['identity.defaultLanguage.required']);
    // Never colour alone, and announced when it appears.
    const message = screen.getByText(en['identity.defaultLanguage.required']!);
    expect(message.closest('[role="alert"]')).not.toBeNull();
  });

  it('refuses to submit until a default is chosen again', async () => {
    const { submitted } = await renderForm({ initial: channel() });
    removeChip(/^Remove pl-PL/);
    expect(submitButton('Save changes').disabled).toBe(true);
    submit();
    expect(submitted).toEqual([]);

    pick('sc-default-lang', 'en');
    expect(field('sc-default-lang').hasAttribute('aria-invalid')).toBe(false);
    expect(screen.queryByText(en['identity.defaultLanguage.required']!)).toBeNull();
    expect(submitButton('Save changes').disabled).toBe(false);
    submit();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.languages).toEqual(['en-US']);
    expect(submitted[0]!.defaultLanguage).toBe('en-US');
  });

  it('does the same on Backspace, which removes the last chip', async () => {
    await renderForm({ initial: channel({ defaultLanguage: 'en-US' }) });
    fireEvent.keyDown(field('sc-languages'), { key: 'Backspace' });
    expect(chips('sc-languages')).toEqual(['pl-PL']);
    expect(field('sc-default-lang').value).toBe('');
    expect(field('sc-default-lang').getAttribute('aria-invalid')).toBe('true');
  });

  it('does the same for the default currency', async () => {
    const { submitted } = await renderForm({ initial: channel() });
    removeChip(/^Remove PLN/);
    expect(field('sc-default-curr').value).toBe('');
    expect(field('sc-default-curr').getAttribute('aria-invalid')).toBe('true');
    expect(describedBy('sc-default-curr')).toContain(en['identity.defaultCurrency.required']);
    submit();
    expect(submitted).toEqual([]);
  });

  it('leaves the default alone when a different entry is removed', async () => {
    const { submitted } = await renderForm({ initial: channel() });
    removeChip(/^Remove en-US/);
    removeChip(/^Remove EUR/);
    expect(field('sc-default-lang').value).toBe('pl-PL — Polish');
    expect(field('sc-default-lang').hasAttribute('aria-invalid')).toBe(false);
    submit();
    expect(submitted[0]!.defaultLanguage).toBe('pl-PL');
    expect(submitted[0]!.defaultCurrency).toBe('PLN');
  });

  it('does not bring the old default back when the entry is selected again', async () => {
    await renderForm({ initial: channel() });
    removeChip(/^Remove pl-PL/);
    pick('sc-languages', 'polish');
    expect(chips('sc-languages')).toEqual(['en-US', 'pl-PL']);
    expect(field('sc-default-lang').value).toBe('');
  });
});

describe('an empty selection', () => {
  it('is reported on the multi-select and blocks the submit', async () => {
    const { submitted } = await renderForm({ initial: channel({ languages: ['pl-PL'] }) });
    removeChip(/^Remove pl-PL/);
    expect(field('sc-languages').getAttribute('aria-invalid')).toBe('true');
    expect(describedBy('sc-languages')).toContain(en['identity.languages.required']);
    // The default has nothing to be picked from, so it says the one thing to do.
    expect(screen.queryByText(en['identity.defaultLanguage.required']!)).toBeNull();
    expect(submitButton('Save changes').disabled).toBe(true);
    submit();
    expect(submitted).toEqual([]);
  });

  it('is reported for currencies too', async () => {
    await renderForm({ initial: channel({ currencies: ['PLN'] }) });
    removeChip(/^Remove PLN/);
    expect(field('sc-currencies').getAttribute('aria-invalid')).toBe('true');
    expect(describedBy('sc-currencies')).toContain(en['identity.currencies.required']);
  });
});

describe('the submitted value', () => {
  it('keeps the shape the page sends on', async () => {
    const { submitted } = await renderForm({ initial: channel() });
    submit();
    expect(submitted).toEqual([
      {
        code: 'pl_retail',
        name: 'PL retail',
        themeCode: '',
        languages: ['pl-PL', 'en-US'],
        defaultLanguage: 'pl-PL',
        currencies: ['PLN', 'EUR'],
        defaultCurrency: 'PLN',
        active: true,
      },
    ]);
  });

  it('starts a new channel from a valid pair of defaults', async () => {
    const { submitted } = await renderForm();
    fireEvent.change(field('sc-code'), { target: { value: 'new-one' } });
    fireEvent.change(field('sc-name'), { target: { value: 'New one' } });
    expect(submitButton('Create channel').disabled).toBe(false);
    submit();
    expect(submitted[0]!.languages).toEqual(['en-US']);
    expect(submitted[0]!.defaultLanguage).toBe('en-US');
    expect(submitted[0]!.currencies).toEqual(['PLN']);
    expect(submitted[0]!.defaultCurrency).toBe('PLN');
  });
});

describe('the Dictionary request', () => {
  it('shows the stored selection, busy, while it is in flight', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    dictionary.respond = async (url) => {
      await gate;
      return answerFromFixtures(url);
    };
    const submitted: FormValue[] = [];
    render(
      <TranslationProvider language="en" initialBundle={bundle('en')}>
        <ChannelIdentityForm
          mode="edit"
          initial={channel()}
          onSubmit={(value: FormValue) => {
            submitted.push(value);
          }}
        />
      </TranslationProvider>,
    );
    expect(field('sc-languages').getAttribute('aria-busy')).toBe('true');
    expect(field('sc-currencies').getAttribute('aria-busy')).toBe('true');
    expect(chips('sc-languages')).toEqual(['pl-PL', 'en-US']);
    fireEvent.focus(field('sc-languages'));
    const listbox = document.getElementById(field('sc-languages').getAttribute('aria-controls')!)!;
    expect(listbox.textContent).toContain(en['identity.dictionary.loading']);
    release!();
    await waitFor(() => {
      expect(field('sc-languages').getAttribute('aria-busy')).not.toBe('true');
    });
    expect(offered('sc-languages', 'german')).toEqual(['de-DE']);
  });

  it('says so when it fails, keeps the stored selection, and can be retried', async () => {
    dictionary.respond = () => Promise.reject(new Error('offline'));
    const { submitted } = await renderForm({ initial: channel() });
    const alert = await screen.findByText(en['identity.dictionary.loadError']!);
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    expect(chips('sc-languages')).toEqual(['pl-PL', 'en-US']);
    // What is stored is still a valid channel; a failed lookup must not block saving it.
    expect(submitButton('Save changes').disabled).toBe(false);

    dictionary.respond = answerFromFixtures;
    fireEvent.click(screen.getByRole('button', { name: en['identity.dictionary.retry']! }));
    await waitFor(() => {
      expect(screen.queryByText(en['identity.dictionary.loadError']!)).toBeNull();
    });
    expect(offered('sc-languages', 'german')).toEqual(['de-DE']);
    submit();
    expect(submitted).toHaveLength(1);
  });

  it('asks for a page large enough for the whole Dictionary', async () => {
    await renderForm();
    const languages = dictionary.requests.find((url) => url.includes('/dictionary/languages'))!;
    expect(Number(new URLSearchParams(languages.split('?')[1]).get('pageSize'))).toBeGreaterThanOrEqual(250);
  });
});

describe('the pickers ship both shipped languages', () => {
  it('has an en and a pl string for every key they render', () => {
    for (const key of [
      'identity.languages.label',
      'identity.languages.placeholder',
      'identity.languages.noMatches',
      'identity.languages.required',
      'identity.languages.help',
      'identity.defaultLanguage.label',
      'identity.defaultLanguage.required',
      'identity.currencies.label',
      'identity.currencies.placeholder',
      'identity.currencies.noMatches',
      'identity.currencies.required',
      'identity.currencies.help',
      'identity.defaultCurrency.label',
      'identity.defaultCurrency.required',
      'identity.pickOption',
      'identity.dictionary.inactive',
      'identity.dictionary.empty',
      'identity.dictionary.loading',
      'identity.dictionary.loadError',
      'identity.dictionary.retry',
    ]) {
      expect(en[key], `missing en: ${key}`).toBeTruthy();
      expect(pl[key], `missing pl: ${key}`).toBeTruthy();
      expect(pl[key], `pl is a copy of en: ${key}`).not.toBe(en[key]);
    }
  });
});
