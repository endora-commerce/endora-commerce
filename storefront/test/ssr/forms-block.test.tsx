// @vitest-environment jsdom
import axe from 'axe-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailablePublicFormDefinition } from '@endora-commerce/contracts';
import { CmsRenderProvider } from '@endora-commerce/cms-components/components/render-context';
import { BlockRenderScope } from '../../components/BlockRenderScope';
import { BlockData } from '../../components/BlockData';
import { PageBuilderRender } from '../../components/PageBuilderRender';
import type { RequestContext } from '../../lib/api/client';
import type { ModulePresenceSet } from '../../lib/api/module-presence';
import { cmsRenderLocation } from '../../lib/page-builder/render-location';

/**
 * `forms.Form` on a storefront page (`specs/170-forms-module/` T051, US2-5, FR-037, SC-004,
 * research R-8, R-10, R-28): the form is in the server HTML, read through the block-data seam with
 * the request's channel and language; after a refused no-JS post the page shows the shopper's
 * answers and the errors again — only for the attempt id on the URL, read from the attempt cookie
 * — and the HTML has no WCAG 2.2 AA violation axe can find.
 *
 * Harness: `renderToString` over the storefront's own block-data seam and forms context, with
 * `fetch`, the request headers and the cookie jar stubbed.
 */

vi.hoisted(() => {
  // jsdom has no ResizeObserver; a block of the page reads one at import (the cms-components precedent).
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

const FORM_ID = '3b0c9f0e-2d1a-4c5b-8e7f-6a5b4c3d2e1f';
const requestHeaders = new Headers({ referer: 'https://search.example/q' });
const jar = new Map<string, string>();

vi.mock('next/headers', () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
}));

const DEFINITION: AvailablePublicFormDefinition = {
  formId: FORM_ID,
  key: 'contact',
  version: 1,
  language: 'pl-PL',
  availability: 'open',
  signedInOnly: false,
  captcha: null,
  texts: { title: 'Napisz do nas', submitLabel: 'Wyślij zapytanie' },
  confirmation: { type: 'message' },
  sections: [
    {
      id: 's1',
      columns: 2,
      fields: [
        { id: 'f1', type: 'text', key: 'name', width: 1, required: true, label: 'Imię' },
        { id: 'f2', type: 'email', key: 'email', width: 1, required: true, label: 'E-mail' },
        { id: 'f3', type: 'textarea', key: 'message', width: 2, required: false, label: 'Wiadomość' },
        { id: 'f4', type: 'hidden', key: 'from', width: 1, required: false, label: '', source: 'referrer' },
        { id: 'f5', type: 'hidden', key: 'page', width: 1, required: false, label: '', source: 'page_url' },
        {
          id: 'f6',
          type: 'privacy_consent',
          key: 'privacy',
          width: 2,
          required: true,
          label: '',
          content: '<p>Akceptuję <a href="/polityka">politykę prywatności</a></p>',
        },
      ],
    },
  ],
};

const DOCUMENT = {
  root: { props: {} },
  content: [
    {
      type: 'cms.Section',
      props: {
        id: 'section-form',
        anchor: 'napisz',
        content: [{ type: 'forms.Form', props: { id: 'form-1', formId: FORM_ID, fieldLook: 'boxed', size: 'm' } }],
      },
    },
  ],
  zones: {},
};

const CTX: RequestContext = { salesChannelCode: 'b2c', locale: 'pl-PL' };

interface RecordedCall {
  url: string;
  init: RequestInit & { next?: { revalidate?: number; tags?: string[] } };
}

const originalFetch = globalThis.fetch;
let calls: RecordedCall[] = [];

function presence(absent: readonly string[] = []): ModulePresenceSet {
  return { isPresent: (id) => !absent.includes(id), presentIds: [], absentIds: absent };
}

/** The definition the read answers; a test may serve another. */
let served: AvailablePublicFormDefinition = DEFINITION;

/** The dictionary's countries, labelled in the requested language as the backend labels them. */
function dictionaryFor(locale: string) {
  const polish = locale.startsWith('pl');
  const country = (code: string, alpha3Code: string, numericCode: string, label: string, sortOrder: number) => ({
    code,
    label,
    alpha3Code,
    numericCode,
    region: 'Europe',
    subregion: null,
    dialCode: null,
    isEuMember: true,
    defaultCurrencyCode: null,
    sortOrder,
  });
  return {
    data: {
      countries: [
        country('DE', 'DEU', '276', polish ? 'Niemcy' : 'Germany', 1),
        country('PL', 'POL', '616', polish ? 'Polska' : 'Poland', 2),
      ],
      currencies: [],
      languages: [],
      defaults: { country: null, currency: null, language: null },
    },
  };
}

beforeEach(() => {
  calls = [];
  jar.clear();
  served = DEFINITION;
  globalThis.fetch = vi.fn(async (input: unknown, init: unknown) => {
    const url = String(input);
    calls.push({ url, init: (init ?? {}) as RecordedCall['init'] });
    if (new URL(url).pathname === `/api/v1/storefront/forms/${FORM_ID}`) {
      return new Response(JSON.stringify({ data: served }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (new URL(url).pathname === '/api/v1/dictionary') {
      return new Response(JSON.stringify(dictionaryFor(new URL(url).searchParams.get('locale') ?? 'en-US')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no' } }), { status: 404 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function ssr(query: Record<string, string> = {}, absent: readonly string[] = []): Promise<string> {
  const { formsRenderContext } = await import('../../lib/page-builder/forms-context');
  const location = cmsRenderLocation('/kontakt', query);
  const forms = await formsRenderContext({ language: 'pl-PL', location, pageTitle: 'Kontakt', ctx: CTX });
  const element = await BlockData({
    documents: [DOCUMENT],
    ctx: CTX,
    modules: presence(absent),
    children: <PageBuilderRender data={DOCUMENT} />,
  });
  return renderToString(
    <BlockRenderScope presence={{ absent: [...absent] }} language="pl-PL">
      <CmsRenderProvider
        embeds={{ blocks: {}, templates: {} }}
        location={location}
        forms={forms}
        localizePath={(path) => `/pl${path}`}
      >
        {element as ReactElement}
      </CmsRenderProvider>
    </BlockRenderScope>,
  );
}

function domOf(html: string): HTMLElement {
  const host = document.createElement('main');
  host.innerHTML = html;
  document.body.replaceChildren(host);
  return host;
}

async function attemptCookie(attemptId: string): Promise<string> {
  const { encodeFormsAttempt } = await import('../../lib/page-builder/forms-context');
  return encodeFormsAttempt({
    attemptId,
    blockId: 'form-1',
    errors: [{ fieldKey: 'email', code: 'invalid_email', message: 'Podaj poprawny adres e-mail.' }],
    answers: [
      ['name', 'Ada'],
      ['email', 'ada@'],
      ['message', 'Dzień dobry'],
    ],
  });
}

describe('forms.Form on a storefront page (T051)', () => {
  it('reads the form once with the channel and the language, tagged, and renders it in the server HTML', async () => {
    const host = domOf(await ssr());
    const reads = calls.filter((call) => new URL(call.url).pathname === `/api/v1/storefront/forms/${FORM_ID}`);
    expect(reads).toHaveLength(1);
    expect(new URL(reads[0]!.url).searchParams.get('language')).toBe('pl-PL');
    expect(reads[0]!.init.next).toEqual({ revalidate: 60, tags: [`forms:form:${FORM_ID}`] });
    const form = host.querySelector('form')!;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe('/pl/forms/submit');
    const hidden = (name: string) => host.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)?.value;
    expect(hidden('formId')).toBe(FORM_ID);
    expect(hidden('blockId')).toBe('form-1');
    expect(hidden('returnTo')).toBe('/pl/kontakt');
    expect(hidden('anchor')).toBe('napisz');
    // The page context of the hidden fields, computed on the server (research R-11).
    expect(hidden('from')).toBe('https://search.example/q');
    expect(hidden('page')).toBe('/kontakt');
    // Polish built-ins where the form has no text of its own.
    expect(host.textContent).toContain('(wymagane)');
    expect(host.querySelector('button[type="submit"]')!.textContent).toContain('Wyślij zapytanie');
  });

  it('shows the shopper’s answers and the errors again after a refused no-JS post (US2-5)', async () => {
    jar.set('forms_attempt', await attemptCookie('attempt-1'));
    const host = domOf(
      await ssr({ formsBlock: 'form-1', formsOutcome: 'error', formsReason: 'invalid', formsAttempt: 'attempt-1' }),
    );
    expect(host.querySelector<HTMLInputElement>('[name="name"]')!.getAttribute('value')).toBe('Ada');
    expect(host.querySelector<HTMLInputElement>('[name="email"]')!.getAttribute('value')).toBe('ada@');
    expect(host.querySelector<HTMLTextAreaElement>('[name="message"]')!.textContent).toBe('Dzień dobry');
    expect(host.querySelector<HTMLInputElement>('[name="email"]')!.getAttribute('aria-invalid')).toBe('true');
    const summary = host.querySelector('[role="alert"]')!;
    expect(summary.textContent).toContain('Podaj poprawny adres e-mail.');
    // The summary links to the refused field.
    const link = summary.querySelector('a')!;
    expect(host.querySelector(link.getAttribute('href')!)).toBe(host.querySelector('[name="email"]'));
  });

  it('shows nothing of an attempt whose id is not the one on the URL', async () => {
    jar.set('forms_attempt', await attemptCookie('attempt-1'));
    const host = domOf(
      await ssr({ formsBlock: 'form-1', formsOutcome: 'error', formsReason: 'invalid', formsAttempt: 'attempt-2' }),
    );
    expect(host.querySelector<HTMLInputElement>('[name="name"]')!.hasAttribute('value')).toBe(false);
    expect(host.textContent).not.toContain('Podaj poprawny adres e-mail.');
  });

  it('reads nothing and renders nothing while forms is absent', async () => {
    const html = await ssr({}, ['forms']);
    expect(calls.some((call) => call.url.includes('/api/v1/storefront/forms/'))).toBe(false);
    expect(html).not.toContain('/forms/submit');
  });

  it('has no WCAG 2.2 AA violation axe can find, fresh and after a refusal (SC-004)', async () => {
    const report = async (html: string) => {
      const host = domOf(html);
      const result = await axe.run(host, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        // jsdom lays nothing out and computes no colour; contrast is the scheme tokens' (admin precedent).
        rules: { 'color-contrast': { enabled: false } },
      });
      return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
    };
    expect(await report(await ssr())).toEqual([]);
    jar.set('forms_attempt', await attemptCookie('attempt-1'));
    expect(
      await report(await ssr({ formsBlock: 'form-1', formsOutcome: 'error', formsReason: 'invalid', formsAttempt: 'attempt-1' })),
    ).toEqual([]);
  });

  it('CmsPageRenderer hands a page with a form the forms context', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/CmsPageRenderer.tsx'), 'utf8');
    expect(source).toMatch(/await formsRenderContext\(/);
    expect(source).toMatch(/forms \? \{ forms \}/);
  });
});

describe('forms.Form on a Polish page (T102, US7-4, FR-067)', () => {
  const POLISH_FORM: AvailablePublicFormDefinition = {
    ...DEFINITION,
    texts: { title: 'Napisz do nas' },
    sections: [
      {
        id: 's1',
        columns: 1,
        fields: [
          { id: 'f1', type: 'text', key: 'name', width: 1, required: true, label: 'Imię', placeholder: 'Jan Kowalski' },
          { id: 'f7', type: 'country', key: 'country', width: 1, required: false, label: 'Kraj dostawy' },
          { id: 'f8', type: 'select', key: 'topic', width: 1, required: false, label: 'Temat', options: [{ id: 'o1', value: 'sales', label: 'Sprzedaż' }] },
        ],
      },
    ],
  };

  it('renders the operator’s Polish texts, the Polish built-ins of the forms catalogue and Polish country names', async () => {
    served = POLISH_FORM;
    const host = domOf(await ssr());
    // The operator's texts, as the read answered them in the page language.
    expect(host.querySelector('h2')!.textContent).toBe('Napisz do nas');
    expect(host.querySelector<HTMLInputElement>('[name="name"]')!.getAttribute('placeholder')).toBe('Jan Kowalski');
    expect(host.querySelector('[name="topic"] option[value="sales"]')!.textContent).toBe('Sprzedaż');
    // The built-ins where the form has none: the button, the markers, the placeholders.
    expect(host.querySelector('button[type="submit"]')!.textContent).toContain('Wyślij');
    expect(host.textContent).toContain('(wymagane)');
    expect(host.querySelector('[name="topic"] option[value=""]')!.textContent).toBe('Wybierz…');
    expect(host.querySelector('[name="country"] option[value=""]')!.textContent).toBe('Wybierz kraj…');
    // The countries in the page language, read from the dictionary with it.
    const countries = [...host.querySelectorAll('[name="country"] option[value]:not([value=""])')].map((option) => option.textContent);
    expect(countries).toEqual(['Niemcy', 'Polska']);
    const dictionary = calls.find((call) => new URL(call.url).pathname === '/api/v1/dictionary')!;
    expect(new URL(dictionary.url).searchParams.get('locale')).toBe('pl-PL');
    expect(host.textContent).not.toMatch(/Choose|Send|\(required\)|Poland|Germany/);
  });

  it('words the CAPTCHA notice for a browser without JavaScript in Polish (OQ-2)', async () => {
    served = { ...POLISH_FORM, captcha: { provider: 'turnstile', siteKey: 'site-key' } };
    const html = await ssr();
    expect(html).toContain('Ten formularz wymaga JavaScriptu, aby potwierdzić, że nie jesteś robotem.');
    // The provider's script is the browser's to load, never in the server HTML.
    expect(html).not.toContain('challenges.cloudflare.com');
  });
});
