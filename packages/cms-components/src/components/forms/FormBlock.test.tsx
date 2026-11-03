// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import type { ComponentConfig } from '@puckeditor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailablePublicFormDefinition } from '@endora-commerce/contracts';
import type { FormBlockProps } from '../../schema/component-types.js';
import { defaultPageBuilderConfig } from '../../index.js';
import { CmsRenderProvider, type CmsFormsContext, type CmsFormsText, type CmsRenderLocation } from '../render-context.js';
import { FormBlock } from './FormBlock.js';
import { FormErrorSummary } from './FormErrorSummary.js';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('./form-block-state.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./form-block-state.js')>()),
  navigateTo: (url: string) => navigate(url),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `forms.Form` — the **static** render of a public form definition
 * (`specs/170-forms-module/` T015, contracts/blocks-and-storefront.md §5, research R-28, FR-069).
 *
 * What the server renders is what a shopper without JavaScript uses and what assistive technology
 * reads, so every control is asserted on the server HTML: labelled, grouped, described, laid out
 * in the section's columns, with the hidden values and the honeypot in place, and with no colour
 * or pixel of its own — the block follows the section's colour scheme.
 */

const FORM_ID = '3b0c9f0e-2d1a-4c5b-8e7f-6a5b4c3d2e1f';

const TEXT: CmsFormsText = {
  submit: 'Send',
  required: '(required)',
  optional: '(optional)',
  errorSummary: 'There is a problem',
  errorSummaryCount: '{n} fields need your attention',
  accepted: 'Thank you.',
  unavailable: 'This form is not available.',
  rateLimited: 'Too many attempts.',
  tooLarge: 'Too large.',
  captchaFailed: 'Verification failed.',
  captchaUnavailable: 'Verification unavailable.',
  needsJavaScript: 'This form needs JavaScript.',
  truncatedAnswers: 'Some answers must be entered again.',
  closed: 'Closed.',
  notYetOpen: 'Not yet open.',
  full: 'Full.',
  signIn: 'Sign in to use this form.',
  signInLink: 'Sign in',
  selectPlaceholder: 'Choose…',
  countryPlaceholder: 'Choose a country…',
  fieldErrors: {
    required: 'Required.',
    invalid_email: 'Invalid e-mail.',
    invalid_phone: 'Invalid phone.',
    invalid_number: 'Invalid number.',
    too_short: 'Too short.',
    too_long: 'Too long.',
    below_min: 'Too small.',
    above_max: 'Too big.',
    step_mismatch: 'Wrong step.',
    invalid_date: 'Invalid date.',
    too_early: 'Too early.',
    too_late: 'Too late.',
    too_few: 'Too few.',
    too_many: 'Too many.',
    unknown_option: 'Unknown option.',
    pattern: 'Wrong format.',
    single_line: 'One line only.',
    invalid_country: 'Unknown country.',
    consent_required: 'Please agree.',
  },
  addressParts: { street: 'Street', line2: 'Address line 2', postalCode: 'Postal code', city: 'City', country: 'Country' },
};

const FORMS: CmsFormsContext = {
  text: TEXT,
  countries: [
    { code: 'DE', label: 'Germany' },
    { code: 'FR', label: 'France' },
    { code: 'PL', label: 'Poland' },
  ],
  viewerSignedIn: false,
  signInPath: '/login?returnTo=%2Fcontact',
  pageContext: {
    pageUrl: '/contact?utm_campaign=autumn',
    pageTitle: 'Contact us',
    referrer: 'https://search.example/',
    query: { utm_campaign: 'autumn' },
  },
  attempt: null,
};

const PART = (label: string, enabled = true, required = false) => ({ enabled, required, label });

const DEFINITION: AvailablePublicFormDefinition = {
  formId: FORM_ID,
  key: 'contact',
  version: 3,
  language: 'en',
  availability: 'open',
  signedInOnly: false,
  captcha: null,
  texts: { title: 'Contact us', description: 'We answer within a day.', submitLabel: 'Send message' },
  confirmation: { type: 'message' },
  sections: [
    {
      id: 's1',
      columns: 3,
      title: 'About you',
      description: 'Tell us who you are.',
      fields: [
        { id: 'f1', type: 'text', key: 'name', width: 2, required: true, label: 'Name', help: 'As on your invoice.', maxLength: 80 },
        { id: 'f2', type: 'email', key: 'email', width: 1, required: true, label: 'E-mail' },
        { id: 'f3', type: 'phone', key: 'phone', width: 1, required: false, label: 'Phone', placeholder: '+48 …' },
        { id: 'f4', type: 'number', key: 'quantity', width: 1, required: false, label: 'Quantity', min: 1, max: 10, step: 1 },
        { id: 'f5', type: 'textarea', key: 'message', width: 3, required: false, label: 'Message', maxLength: 2000 },
      ],
    },
    {
      id: 's2',
      columns: 2,
      fields: [
        {
          id: 'f6',
          type: 'select',
          key: 'topic',
          width: 1,
          required: false,
          label: 'Topic',
          options: [
            { id: 'o1', value: 'sales', label: 'Sales' },
            { id: 'o2', value: 'support', label: 'Support' },
          ],
        },
        {
          id: 'f7',
          type: 'radio',
          key: 'contact_by',
          width: 1,
          required: true,
          label: 'Contact me by',
          options: [
            { id: 'o1', value: 'email', label: 'E-mail' },
            { id: 'o2', value: 'phone', label: 'Phone' },
          ],
        },
        {
          id: 'f8',
          type: 'checkboxes',
          key: 'interests',
          width: 2,
          required: false,
          label: 'Interests',
          options: [
            { id: 'o1', value: 'doors', label: 'Doors' },
            { id: 'o2', value: 'windows', label: 'Windows' },
          ],
        },
        { id: 'f9', type: 'checkbox', key: 'company', width: 1, required: false, label: 'I buy for a company' },
        { id: 'f10', type: 'datetime', key: 'visit', width: 1, required: false, label: 'Visit', mode: 'date', earliest: '2026-01-01' },
        { id: 'f11', type: 'country', key: 'country', width: 1, required: false, label: 'Country', allowedCountries: ['PL', 'DE'] },
        {
          id: 'f12',
          type: 'address',
          key: 'address',
          width: 2,
          required: false,
          label: 'Address',
          parts: {
            street: PART('Street', true, true),
            line2: PART('Line 2', false),
            postalCode: PART('Postcode'),
            city: PART('Town', true, true),
            country: PART('Country'),
          },
        },
        { id: 'f13', type: 'hidden', key: 'campaign', width: 1, required: false, label: '', source: 'query_param', paramName: 'utm_campaign' },
        { id: 'f14', type: 'hidden', key: 'page', width: 1, required: false, label: '', source: 'page_url' },
        { id: 'f15', type: 'hidden', key: 'title', width: 1, required: false, label: '', source: 'page_title' },
        { id: 'f16', type: 'hidden', key: 'from', width: 1, required: false, label: '', source: 'referrer' },
        { id: 'f17', type: 'hidden', key: 'origin', width: 1, required: false, label: '', source: 'static', staticValue: 'web' },
        { id: 'f18', type: 'content', width: 2, content: '<p>Read <a href="/privacy">our policy</a>.</p><script>alert(1)</script>' },
        { id: 'f19', type: 'section_break', width: 2, title: 'Consents' },
        {
          id: 'f20',
          type: 'privacy_consent',
          key: 'privacy',
          width: 2,
          required: true,
          label: '',
          content: '<p>I accept the <a href="/privacy">privacy policy</a><img src=x onerror="alert(1)"></p>',
        },
        { id: 'f21', type: 'marketing_consent', key: 'marketing', width: 2, required: false, label: '', content: '<p>Send me news</p>' },
        { id: 'f22', type: 'terms', key: 'terms', width: 2, required: true, label: '', content: '<p>I accept the terms</p>' },
      ],
    },
  ],
};

const PRESETS: FormBlockProps = {
  formId: FORM_ID,
  fieldLook: 'boxed',
  size: 'm',
  align: 'start',
  showTitle: true,
  showDescription: true,
};

function dom(props: Partial<FormBlockProps> = {}, forms: CmsFormsContext | undefined = FORMS): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} {...(forms ? { forms } : {})}>
      <FormBlock {...PRESETS} {...props} id="block-1" definition={DEFINITION} />
    </CmsRenderProvider>,
  );
  return host;
}

const control = (host: HTMLElement, name: string) => host.querySelector<HTMLElement>(`[name="${name}"]`);
const labelFor = (host: HTMLElement, element: HTMLElement | null) =>
  element ? host.querySelector<HTMLLabelElement>(`label[for="${element.id}"]`) : null;

const STYLESHEET = resolve(dirname(fileURLToPath(import.meta.url)), '../../../styles/cms-components.css');

describe('FormBlock — the static render (T015)', () => {
  it.each([
    ['name', 'Name', 'INPUT', 'text'],
    ['email', 'E-mail', 'INPUT', 'email'],
    ['phone', 'Phone', 'INPUT', 'tel'],
    ['quantity', 'Quantity', 'INPUT', 'number'],
    ['message', 'Message', 'TEXTAREA', null],
    ['topic', 'Topic', 'SELECT', null],
    ['company', 'I buy for a company', 'INPUT', 'checkbox'],
    ['visit', 'Visit', 'INPUT', 'date'],
    ['country', 'Country', 'SELECT', null],
  ])('renders %s as a labelled control', (name, label, tag, type) => {
    const host = dom();
    const element = control(host, name);
    expect(element?.tagName).toBe(tag);
    if (type) expect(element?.getAttribute('type')).toBe(type);
    expect(labelFor(host, element)?.textContent).toContain(label);
  });

  it('marks required fields with aria-required and a spoken marker', () => {
    const host = dom();
    expect(control(host, 'name')?.getAttribute('aria-required')).toBe('true');
    expect(control(host, 'phone')?.hasAttribute('aria-required')).toBe(false);
    expect(labelFor(host, control(host, 'name'))?.textContent).toContain('(required)');
  });

  it('describes a field by its help text', () => {
    const host = dom();
    const describedBy = control(host, 'name')?.getAttribute('aria-describedby') ?? '';
    const help = describedBy.split(' ').map((id) => host.querySelector(`[id="${id}"]`)?.textContent);
    expect(help).toContain('As on your invoice.');
  });

  it('carries the type limits onto the controls', () => {
    const host = dom();
    expect(control(host, 'name')?.getAttribute('maxlength')).toBe('80');
    expect(control(host, 'quantity')?.getAttribute('min')).toBe('1');
    expect(control(host, 'quantity')?.getAttribute('max')).toBe('10');
    expect(control(host, 'quantity')?.getAttribute('step')).toBe('1');
    expect(control(host, 'visit')?.getAttribute('min')).toBe('2026-01-01');
    expect(control(host, 'phone')?.getAttribute('placeholder')).toBe('+48 …');
  });

  it('offers a placeholder and the options in a select, and only the allowed countries', () => {
    const host = dom();
    const topic = [...(control(host, 'topic')?.querySelectorAll('option') ?? [])].map((o) => [o.value, o.textContent]);
    expect(topic).toEqual([
      ['', 'Choose…'],
      ['sales', 'Sales'],
      ['support', 'Support'],
    ]);
    const countries = [...(control(host, 'country')?.querySelectorAll('option') ?? [])].map((o) => [o.value, o.textContent]);
    expect(countries).toEqual([
      ['', 'Choose a country…'],
      ['DE', 'Germany'],
      ['PL', 'Poland'],
    ]);
  });

  it('groups radio and checkbox options in a fieldset with a legend', () => {
    const host = dom();
    for (const [name, legend, type, count] of [
      ['contact_by', 'Contact me by', 'radio', 2],
      ['interests', 'Interests', 'checkbox', 2],
    ] as const) {
      const inputs = [...host.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];
      expect(inputs).toHaveLength(count);
      const fieldset = inputs[0]?.closest('fieldset');
      expect(fieldset?.querySelector('legend')?.textContent).toContain(legend);
      for (const input of inputs) {
        expect(input.type).toBe(type);
        expect(labelFor(host, input)?.textContent).not.toBe('');
      }
    }
    expect(host.querySelector('input[name="contact_by"]')?.closest('fieldset')?.getAttribute('aria-required')).toBe('true');
  });

  it('renders the enabled address parts as labelled inputs in a fieldset', () => {
    const host = dom();
    const parts = [...host.querySelectorAll<HTMLInputElement>('[name^="address."]')].map((input) => [
      input.name,
      labelFor(host, input)?.textContent?.replace('(required)', '').trim(),
    ]);
    expect(parts).toEqual([
      ['address.street', 'Street'],
      ['address.postalCode', 'Postcode'],
      ['address.city', 'Town'],
      ['address.country', 'Country'],
    ]);
    expect(host.querySelector('input[name="address.street"]')?.closest('fieldset')?.querySelector('legend')?.textContent).toContain(
      'Address',
    );
  });

  it('carries each hidden field’s value from the page context or its static value', () => {
    const host = dom();
    const value = (name: string) => host.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)?.value;
    expect(value('campaign')).toBe('autumn');
    expect(value('page')).toBe('/contact?utm_campaign=autumn');
    expect(value('title')).toBe('Contact us');
    expect(value('from')).toBe('https://search.example/');
    expect(value('origin')).toBe('web');
  });

  it('renders consents as required checkboxes labelled by their sanitised rich text', () => {
    const host = dom();
    const privacy = control(host, 'privacy') as HTMLInputElement;
    expect(privacy.type).toBe('checkbox');
    expect(privacy.getAttribute('aria-required')).toBe('true');
    expect(privacy.hasAttribute('checked')).toBe(false);
    const label = labelFor(host, privacy);
    expect(label?.querySelector('a')?.getAttribute('href')).toBe('/privacy');
    expect(label?.innerHTML).not.toContain('onerror');
    expect((control(host, 'marketing') as HTMLInputElement).hasAttribute('aria-required')).toBe(false);
    expect(labelFor(host, control(host, 'terms'))?.textContent).toContain('I accept the terms');
  });

  it('renders content sanitised and a section break as a heading', () => {
    const host = dom();
    expect(host.innerHTML).toContain('our policy');
    expect(host.innerHTML).not.toContain('<script');
    expect([...host.querySelectorAll('h3, h4')].map((h) => h.textContent)).toContain('Consents');
  });

  it('lays sections out in their columns and fields across their widths (FR-016)', () => {
    const host = dom();
    const grids = [...host.querySelectorAll('.cmsc-pb-form__grid')].map((grid) => grid.className);
    expect(grids[0]).toContain('cmsc-pb-form__grid--cols-3');
    expect(grids[1]).toContain('cmsc-pb-form__grid--cols-2');
    expect(control(host, 'name')?.closest('.cmsc-pb-form__cell')?.className).toContain('cmsc-pb-form__cell--span-2');
    expect(control(host, 'message')?.closest('.cmsc-pb-form__cell')?.className).toContain('cmsc-pb-form__cell--span-3');
    expect(host.textContent).toContain('About you');
    expect(host.textContent).toContain('Tell us who you are.');
  });

  it('hides the honeypot from sight and from assistive technology (FR-040)', () => {
    const host = dom();
    const trap = control(host, 'hp_extra') as HTMLInputElement;
    expect(trap).not.toBeNull();
    expect(trap.getAttribute('tabindex')).toBe('-1');
    expect(trap.getAttribute('autocomplete')).toBe('off');
    const wrapper = trap.closest('[aria-hidden="true"]');
    expect(wrapper?.className).toContain('cmsc-pb-form__hp');
  });

  it('turns the presets into classes', () => {
    const root = dom({ fieldLook: 'pill', size: 'l', align: 'center' }).querySelector('.cmsc-pb-form');
    expect(root?.className).toContain('cmsc-pb-form--look-pill');
    expect(root?.className).toContain('cmsc-pb-form--size-l');
    expect(root?.className).toContain('cmsc-pb-form--align-center');
    const defaults = dom({}).querySelector('.cmsc-pb-form');
    expect(defaults?.className).toContain('cmsc-pb-form--look-boxed');
    expect(defaults?.className).toContain('cmsc-pb-form--size-m');
    expect(defaults?.className).toContain('cmsc-pb-form--align-start');
  });

  it('shows the title and description unless switched off', () => {
    expect(dom().textContent).toContain('We answer within a day.');
    expect([...dom().querySelectorAll('h2')].map((h) => h.textContent)).toContain('Contact us');
    const bare = dom({ showTitle: false, showDescription: false });
    expect([...bare.querySelectorAll('h2')]).toHaveLength(0);
    expect(bare.textContent).not.toContain('We answer within a day.');
  });

  it('labels the submit button with the form’s text', () => {
    const button = dom().querySelector('button[type="submit"]');
    expect(button?.textContent).toContain('Send message');
  });

  it('has no colour and no pixel value of its own', () => {
    for (const element of dom().querySelectorAll<HTMLElement>('[style]')) {
      const style = element.getAttribute('style') ?? '';
      expect(style).not.toMatch(/color|background|#[0-9a-f]{3,8}\b|rgb|\d+px/i);
    }
  });

  it('writes in the brand’s body font, as every other block does', () => {
    const css = readFileSync(STYLESHEET, 'utf8').replace(/\s+/g, ' ');
    const rule = css.indexOf(') { font-family: var(--cmsb-font-body, inherit);');
    const list = css.slice(css.lastIndexOf(':where(', rule) + ':where('.length, rule).replace(/\/\*.*?\*\//g, '');
    expect(list.split(',').map((selector) => selector.trim())).toContain('.cmsc-pb-form');
  });

  it('keeps a consent’s required marker on the line of its text', () => {
    // The text is a rich paragraph: a block paragraph would push the marker onto a line of its own.
    const css = readFileSync(STYLESHEET, 'utf8').replace(/\s+/g, ' ');
    expect(css).toMatch(/\.cmsc-pb-form__consent-text > p:last-child \{ display: inline; \}/);
  });

  it('falls back to English built-ins without a forms context (the editor)', () => {
    const host = dom({}, undefined);
    expect([...(control(host, 'topic')?.querySelectorAll('option') ?? [])][0]?.textContent).toBe('Choose…');
    expect(labelFor(host, control(host, 'name'))?.textContent).toContain('(required)');
  });
});

describe('FormErrorSummary', () => {
  it('renders nothing without errors', () => {
    expect(renderToString(<FormErrorSummary id="s" title="There is a problem" errors={[]} />)).toBe('');
  });

  it('lists each error as a link to its field, in an alert', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToString(
      <FormErrorSummary
        id="summary"
        title="There is a problem"
        errors={[
          { targetId: 'pb-form-block-1-f1', message: 'Name: Required.' },
          { targetId: 'pb-form-block-1-f2', message: 'E-mail: Invalid e-mail.' },
        ]}
      />,
    );
    const summary = host.querySelector('#summary');
    expect(summary?.getAttribute('role')).toBe('alert');
    expect(summary?.getAttribute('tabindex')).toBe('-1');
    expect([...host.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent])).toEqual([
      ['#pb-form-block-1-f1', 'Name: Required.'],
      ['#pb-form-block-1-f2', 'E-mail: Invalid e-mail.'],
    ]);
  });
});

// ── T049 — submission, outcome addressing and confirmation (US2) ──────────────────

const LOCATION: CmsRenderLocation = {
  path: '/contact',
  query: { utm_campaign: 'autumn', formsBlock: 'old', formsOutcome: 'error', formsReason: 'invalid', formsAttempt: 'a1' },
};

function render(
  definition: typeof DEFINITION | Parameters<typeof FormBlock>[0]['definition'],
  options: { location?: CmsRenderLocation; forms?: CmsFormsContext; id?: string } = {},
): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider
      embeds={{ blocks: {}, templates: {} }}
      forms={options.forms ?? FORMS}
      location={options.location ?? { path: '/contact', query: {} }}
      localizePath={(path) => `/pl${path}`}
    >
      <FormBlock {...PRESETS} id={options.id ?? 'block-1'} definition={definition} />
    </CmsRenderProvider>,
  );
  return host;
}

const hidden = (host: HTMLElement, name: string) =>
  host.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)?.value;

describe('FormBlock — the plain post (T049, FR-037)', () => {
  it('posts to the page language’s /forms/submit with the form, the block and where to come back to', () => {
    const host = render(DEFINITION, { location: LOCATION });
    const form = host.querySelector('form')!;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe('/pl/forms/submit');
    expect(hidden(host, 'formId')).toBe(FORM_ID);
    expect(hidden(host, 'blockId')).toBe('block-1');
    // The handler's own keys are gone from the page to come back to; the page's own stay.
    expect(hidden(host, 'returnTo')).toBe('/pl/contact?utm_campaign=autumn');
    // The page context of hidden fields travels as their values.
    expect(hidden(host, 'campaign')).toBe('autumn');
    expect(hidden(host, 'page')).toBe('/contact?utm_campaign=autumn');
  });

  it('shows an outcome only when it is addressed to this block (US2-7)', () => {
    const accepted = { path: '/contact', query: { formsBlock: 'block-1', formsOutcome: 'accepted' } };
    expect(render(DEFINITION, { location: accepted }).textContent).toContain('Thank you.');
    expect(render(DEFINITION, { location: accepted, id: 'block-2' }).textContent).not.toContain('Thank you.');
    const refused = { path: '/contact', query: { formsBlock: 'block-1', formsOutcome: 'error', formsReason: 'rate_limited' } };
    expect(render(DEFINITION, { location: refused }).textContent).toContain('Too many attempts.');
    expect(render(DEFINITION, { location: refused, id: 'block-2' }).textContent).not.toContain('Too many attempts.');
  });

  it('shows the form’s own success text when it has one', () => {
    const own = { ...DEFINITION, texts: { ...DEFINITION.texts, success: '<p>We got it!</p>' } };
    const host = render(own, { location: { path: '/contact', query: { formsBlock: 'block-1', formsOutcome: 'accepted' } } });
    expect(host.textContent).toContain('We got it!');
    expect(host.querySelector('[role="status"]')).not.toBeNull();
  });

  it('re-shows a refused attempt’s answers and errors to its own block only (US2-5)', () => {
    const attempt = {
      blockId: 'block-1',
      errors: [{ fieldKey: 'email', code: 'invalid_email', message: 'Enter a real address.' }],
      answers: { name: 'Ada', email: 'ada@', interests: ['windows'], 'address.city': 'Kraków' },
      truncated: true,
    };
    const location = { path: '/contact', query: { formsBlock: 'block-1', formsOutcome: 'error', formsReason: 'invalid', formsAttempt: 'x' } };
    const host = render(DEFINITION, { location, forms: { ...FORMS, attempt } });
    expect(host.querySelector<HTMLInputElement>('[name="name"]')!.getAttribute('value')).toBe('Ada');
    expect(host.querySelector<HTMLInputElement>('[name="email"]')!.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector<HTMLInputElement>('[name="interests"][value="windows"]')!.hasAttribute('checked')).toBe(true);
    expect(host.querySelector<HTMLInputElement>('[name="address.city"]')!.getAttribute('value')).toBe('Kraków');
    const summary = host.querySelector('[role="alert"]')!;
    expect(summary.textContent).toContain('Enter a real address.');
    expect(host.textContent).toContain('Some answers must be entered again.');
    // Another block on the page shows none of it.
    const other = render(DEFINITION, { location, forms: { ...FORMS, attempt }, id: 'block-2' });
    expect(other.querySelector<HTMLInputElement>('[name="name"]')!.hasAttribute('value')).toBe(false);
    expect(other.textContent).not.toContain('Enter a real address.');
  });
});

describe('FormBlock — what a form that takes no entry shows (T049, US2-3)', () => {
  it('renders nothing for an unavailable form', () => {
    expect(render({ formId: FORM_ID, availability: 'unavailable' }).innerHTML).toBe('');
  });

  it('shows a closed form’s message instead of the form', () => {
    const host = render({ ...DEFINITION, availability: 'closed', texts: { ...DEFINITION.texts, closed: 'Applications closed.' } });
    expect(host.querySelector('form')).toBeNull();
    expect(host.textContent).toContain('Applications closed.');
  });

  it('falls back to the built-in words for not yet open and full', () => {
    expect(render({ ...DEFINITION, availability: 'not_yet_open' }).textContent).toContain('Not yet open.');
    expect(render({ ...DEFINITION, availability: 'full' }).textContent).toContain('Full.');
  });

  it('asks an anonymous visitor to sign in to a signed-in-only form', () => {
    const host = render({ ...DEFINITION, signedInOnly: true });
    expect(host.querySelector('form')).toBeNull();
    // In the page language, like every link the block renders.
    expect(host.querySelector('a')!.getAttribute('href')).toBe('/pl/login?returnTo=%2Fcontact');
    expect(render({ ...DEFINITION, signedInOnly: true }, { forms: { ...FORMS, viewerSignedIn: true } }).querySelector('form')).not.toBeNull();
  });
});

describe('FormBlock — with JavaScript (T049, US2-6)', () => {
  let root: Root | null = null;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    navigate.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  function mount(definition: typeof DEFINITION = DEFINITION): HTMLElement {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <CmsRenderProvider
          embeds={{ blocks: {}, templates: {} }}
          forms={FORMS}
          location={{ path: '/contact', query: {} }}
          localizePath={(path) => `/pl${path}`}
        >
          <FormBlock {...PRESETS} id="block-1" definition={definition} />
        </CmsRenderProvider>,
      ),
    );
    return host;
  }

  function type(element: HTMLInputElement, value: string): void {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function submit(host: HTMLElement): Promise<void> {
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  }

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('posts with Accept: application/json, keeps the answers on a refusal and shows the errors', async () => {
    fetchMock.mockResolvedValue(
      json(400, { error: 'invalid', fields: [{ fieldKey: 'email', code: 'invalid_email', message: 'Enter a real address.' }] }),
    );
    const host = mount();
    type(host.querySelector<HTMLInputElement>('[name="email"]')!, 'ada@');
    await submit(host);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/pl/forms/submit');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Accept']).toBe('application/json');
    expect((init.body as FormData).get('formId')).toBe(FORM_ID);
    expect(host.querySelector<HTMLInputElement>('[name="email"]')!.value).toBe('ada@');
    expect(host.querySelector<HTMLInputElement>('[name="email"]')!.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Enter a real address.');
  });

  it('shows the confirmation message inline on acceptance', async () => {
    fetchMock.mockResolvedValue(json(200, { status: 'accepted', confirmation: { type: 'message', message: '' } }));
    const host = mount();
    await submit(host);
    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('[role="status"]')!.textContent).toContain('Thank you.');
  });

  it('says why a refusal that is not about the answers happened', async () => {
    fetchMock.mockResolvedValue(json(429, { error: 'rate_limited' }));
    const host = mount();
    await submit(host);
    expect(host.textContent).toContain('Too many attempts.');
    expect(host.querySelector('form')).not.toBeNull();
  });

  it('goes to the redirect address, or to the CMS page in the page language', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { status: 'accepted', confirmation: { type: 'redirect', url: 'https://example.com/thanks' } }));
    const host = mount();
    await submit(host);
    expect(navigate).toHaveBeenCalledWith('https://example.com/thanks');
    fetchMock.mockResolvedValueOnce(json(200, { status: 'accepted', confirmation: { type: 'page', path: '/dziekujemy' } }));
    await submit(host);
    expect(navigate).toHaveBeenLastCalledWith('/pl/dziekujemy');
  });
});

describe('forms.Form in the Page Builder (T049, US2-9)', () => {
  const config = defaultPageBuilderConfig.components['forms.Form'] as unknown as ComponentConfig | undefined;

  it('is registered', () => {
    expect(config).toBeDefined();
  });

  it('offers only the form and presets — no pixel, colour, text or field option', () => {
    const fields = config!.fields as Record<string, { type: string; options?: { value: unknown }[] }>;
    const own = Object.keys(fields).filter((key) => key !== 'hideOn' && key !== 'editorName');
    expect(own.sort()).toEqual(['align', 'buttonLook', 'fieldLook', 'formId', 'showDescription', 'showTitle', 'size']);
    expect(fields['fieldLook']!.options!.map((option) => option.value)).toEqual(['boxed', 'underline', 'pill']);
    expect(fields['size']!.options!.map((option) => option.value)).toEqual(['s', 'm', 'l']);
    expect(fields['align']!.options!.map((option) => option.value)).toEqual(['start', 'center']);
    expect(JSON.stringify(fields)).not.toMatch(/px|colou?r|recipient/i);
  });
});

// ── T065 — conditional logic and error rendering (US3, FR-030, FR-032, FR-069, R-28) ──

const CONDITIONAL: AvailablePublicFormDefinition = {
  ...DEFINITION,
  texts: { submitLabel: 'Send' },
  sections: [
    {
      id: 'c1',
      columns: 1,
      fields: [
        { id: 'c_name', type: 'text', key: 'name', width: 1, required: true, label: 'Name' },
        {
          id: 'c_topic',
          type: 'select',
          key: 'topic',
          width: 1,
          required: false,
          label: 'Topic',
          options: [
            { id: 'o1', value: 'sales', label: 'Sales' },
            { id: 'o2', value: 'support', label: 'Support' },
          ],
        },
        {
          id: 'c_order',
          type: 'text',
          key: 'order',
          width: 1,
          required: true,
          label: 'Order number',
          visibility: { connective: 'and', groups: [[{ fieldId: 'c_topic', operator: 'equals', value: 'support' }]] },
        },
        { id: 'c_mail', type: 'email', key: 'email', width: 1, required: true, label: 'E-mail' },
      ],
    },
    {
      id: 'c2',
      columns: 1,
      title: 'Your company',
      visibility: { connective: 'and', groups: [[{ fieldId: 'c_topic', operator: 'equals', value: 'sales' }]] },
      fields: [{ id: 'c_company', type: 'text', key: 'company', width: 1, required: false, label: 'Company' }],
    },
  ],
};

const cellOf = (host: HTMLElement, name: string) => host.querySelector(`[name="${name}"]`)!.closest('.cmsc-pb-form__cell');

describe('FormBlock — initial visibility on the server (T065, R-28)', () => {
  it('renders an element hidden by its rule with the hidden attribute, and the others without it', () => {
    const host = render(CONDITIONAL);
    expect(cellOf(host, 'order')!.hasAttribute('hidden')).toBe(true);
    expect(host.querySelector('#pb-form-block-1-c2')!.hasAttribute('hidden')).toBe(true);
    expect(cellOf(host, 'name')!.hasAttribute('hidden')).toBe(false);
    expect(host.querySelector('#pb-form-block-1-c1')!.hasAttribute('hidden')).toBe(false);
  });

  it('evaluates the defaults: a default that satisfies a rule shows its element', () => {
    const withDefault: AvailablePublicFormDefinition = {
      ...CONDITIONAL,
      sections: CONDITIONAL.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) =>
          field.type === 'select' && field.id === 'c_topic' ? { ...field, defaultValue: 'support' } : field,
        ),
      })),
    };
    const host = render(withDefault);
    expect(cellOf(host, 'order')!.hasAttribute('hidden')).toBe(false);
    expect(host.querySelector('#pb-form-block-1-c2')!.hasAttribute('hidden')).toBe(true);
  });

  it('evaluates a refused attempt’s answers, not the defaults', () => {
    const host = render(CONDITIONAL, {
      location: { path: '/contact', query: { formsBlock: 'block-1', formsOutcome: 'error', formsReason: 'invalid', formsAttempt: 'a1' } },
      forms: { ...FORMS, attempt: { blockId: 'block-1', answers: { topic: 'support' }, errors: [], truncated: false } },
    });
    expect(cellOf(host, 'order')!.hasAttribute('hidden')).toBe(false);
  });

  it('reveals every conditional element to a browser without JavaScript, which the server then judges', () => {
    const host = render(CONDITIONAL);
    const conditional = [...host.querySelectorAll('[data-cmsc-form-conditional]')];
    expect(conditional.length).toBe(2);
    expect(host.innerHTML).toMatch(/<noscript><style>[^<]*\[data-cmsc-form-conditional\][^<]*display:\s*block !important[^<]*<\/style><\/noscript>/);
  });

  it('marks nothing conditional in a form without rules', () => {
    const host = render(DEFINITION);
    expect(host.querySelectorAll('[hidden]').length).toBe(0);
    expect(host.querySelector('noscript')).toBeNull();
  });
});

describe('FormBlock — live conditional logic and refusals with JavaScript (T065, FR-069)', () => {
  let root: Root | null = null;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  function mount(definition: AvailablePublicFormDefinition = CONDITIONAL): HTMLElement {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} forms={FORMS} location={{ path: '/contact', query: {} }}>
          <FormBlock {...PRESETS} id="block-1" definition={definition} />
        </CmsRenderProvider>,
      ),
    );
    return host;
  }

  function choose(select: HTMLSelectElement, value: string): void {
    act(() => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  async function submit(host: HTMLElement): Promise<void> {
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  }

  it('shows and hides fields and sections as the shopper answers (FR-030)', () => {
    const host = mount();
    const topic = host.querySelector<HTMLSelectElement>('[name="topic"]')!;
    choose(topic, 'support');
    expect(cellOf(host, 'order')!.hasAttribute('hidden')).toBe(false);
    expect(host.querySelector('#pb-form-block-1-c2')!.hasAttribute('hidden')).toBe(true);
    choose(topic, 'sales');
    expect(cellOf(host, 'order')!.hasAttribute('hidden')).toBe(true);
    expect(host.querySelector('#pb-form-block-1-c2')!.hasAttribute('hidden')).toBe(false);
  });

  it('shows each refused answer in the summary and under its field, with an icon and text', async () => {
    fetchMock.mockResolvedValue(json(400, { error: 'invalid', fields: [{ fieldKey: 'email', code: 'invalid_email', message: '' }] }));
    const host = mount();
    await submit(host);
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Invalid e-mail.');
    const inline = host.querySelector('#pb-form-block-1-c_mail-error')!;
    expect(inline.textContent).toBe('Invalid e-mail.');
    expect(inline.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('focuses the summary, then the first refused field in the form’s order (FR-069)', async () => {
    fetchMock.mockResolvedValue(
      json(400, {
        error: 'invalid',
        fields: [
          { fieldKey: 'name', code: 'required', message: 'Name is required.' },
          { fieldKey: 'email', code: 'invalid_email', message: 'Bad e-mail.' },
        ],
      }),
    );
    const host = mount();
    const order: string[] = [];
    host.addEventListener('focusin', (event) => order.push((event.target as HTMLElement).id));
    await submit(host);
    expect(order).toEqual(['pb-form-block-1-summary', 'pb-form-block-1-c_name']);
    expect(document.activeElement).toBe(host.querySelector('[name="name"]'));
  });

  it('keeps the focus on the summary when the refusal names no field', async () => {
    fetchMock.mockResolvedValue(json(429, { error: 'rate_limited' }));
    const host = mount();
    await submit(host);
    expect(document.activeElement).toBe(host.querySelector('[role="alert"]'));
  });
});

describe('FormBlock — CAPTCHA and restriction states (T094, US6, FR-042, FR-043)', () => {
  const TURNSTILE = { ...DEFINITION, captcha: { provider: 'turnstile' as const, siteKey: 'site-key-1' } };
  const HCAPTCHA = { ...DEFINITION, captcha: { provider: 'hcaptcha' as const, siteKey: 'site-key-2' } };
  const roots: Root[] = [];
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    for (const root of roots.splice(0)) act(() => root.unmount());
    document.head.querySelectorAll('script').forEach((script) => script.remove());
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  function mount(definition: AvailablePublicFormDefinition, id = 'block-1'): HTMLElement {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    act(() =>
      root.render(
        <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} forms={FORMS} location={{ path: '/contact', query: {} }}>
          <FormBlock {...PRESETS} id={id} definition={definition} />
        </CmsRenderProvider>,
      ),
    );
    return host;
  }

  const scripts = () => [...document.querySelectorAll<HTMLScriptElement>('script[src]')].map((script) => script.src);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('requests no provider script for a form without CAPTCHA', () => {
    mount(DEFINITION);
    expect(scripts()).toEqual([]);
  });

  it('requests the provider script in an effect, never in the server HTML', () => {
    const html = render(TURNSTILE).innerHTML;
    expect(html).not.toContain('challenges.cloudflare.com');
    expect(scripts()).toEqual([]);
    mount(TURNSTILE);
    expect(scripts()).toEqual(['https://challenges.cloudflare.com/turnstile/v0/api.js']);
    const script = document.querySelector<HTMLScriptElement>('script[src]')!;
    expect(script.async).toBe(true);
  });

  it('requests it once per page, however many CAPTCHA forms the page holds', () => {
    mount(TURNSTILE, 'block-1');
    mount(TURNSTILE, 'block-2');
    expect(scripts()).toEqual(['https://challenges.cloudflare.com/turnstile/v0/api.js']);
  });

  it('loads hCaptcha from its own address', () => {
    mount(HCAPTCHA);
    expect(scripts()).toEqual(['https://js.hcaptcha.com/1/api.js']);
  });

  it('renders the provider’s container with the site key inside the form', () => {
    const turnstile = render(TURNSTILE).querySelector('form .cf-turnstile');
    expect(turnstile?.getAttribute('data-sitekey')).toBe('site-key-1');
    const hcaptcha = render(HCAPTCHA).querySelector('form .h-captcha');
    expect(hcaptcha?.getAttribute('data-sitekey')).toBe('site-key-2');
    expect(render(DEFINITION).querySelector('.cf-turnstile, .h-captcha')).toBeNull();
  });

  it('sends the token in the provider’s own field', async () => {
    fetchMock.mockResolvedValue(json(200, { status: 'accepted', confirmation: { type: 'message', message: '' } }));
    const host = mount(TURNSTILE);
    // What the provider's widget does once solved: a hidden input inside its container.
    const token = document.createElement('input');
    token.type = 'hidden';
    token.name = 'cf-turnstile-response';
    token.value = 'solved-token';
    host.querySelector('.cf-turnstile')!.appendChild(token);
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.body as FormData).get('cf-turnstile-response')).toBe('solved-token');
  });

  it('resets the widget after a refusal, as a token is good for one check', async () => {
    const reset = vi.fn();
    vi.stubGlobal('turnstile', { reset, render: vi.fn() });
    fetchMock.mockResolvedValue(json(400, { error: 'captcha' }));
    const host = mount(TURNSTILE);
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(host.textContent).toContain('Verification failed.');
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('renders the widget itself into a container mounted after the script loaded', () => {
    const renderWidget = vi.fn();
    vi.stubGlobal('turnstile', { reset: vi.fn(), render: renderWidget });
    const host = mount(TURNSTILE);
    expect(renderWidget).toHaveBeenCalledWith(host.querySelector('.cf-turnstile'), { sitekey: 'site-key-1' });
  });

  it('says that the form needs JavaScript to a browser without it (OQ-2)', () => {
    const html = render(TURNSTILE).innerHTML;
    expect(html).toMatch(/<noscript>.*This form needs JavaScript\..*<\/noscript>/s);
    expect(render(DEFINITION).innerHTML).not.toContain('This form needs JavaScript.');
  });

  it('says the verification service is unreachable when the server could not check', async () => {
    fetchMock.mockResolvedValue(json(503, { error: 'captcha_unavailable' }));
    const host = mount(TURNSTILE);
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(host.textContent).toContain('Verification unavailable.');
    const location = { path: '/contact', query: { formsBlock: 'block-1', formsOutcome: 'error', formsReason: 'captcha_unavailable' } };
    expect(render(TURNSTILE, { location }).textContent).toContain('Verification unavailable.');
  });

  it('shows the form’s own message, else the built-in one, for full and not yet open', () => {
    expect(render({ ...DEFINITION, availability: 'full', texts: { ...DEFINITION.texts, full: 'All seats taken.' } }).textContent).toContain(
      'All seats taken.',
    );
    expect(render({ ...DEFINITION, availability: 'full' }).textContent).toContain('Full.');
    expect(
      render({ ...DEFINITION, availability: 'not_yet_open', texts: { ...DEFINITION.texts, notYetOpen: 'Opens Monday.' } }).textContent,
    ).toContain('Opens Monday.');
    // A form that takes no entry loads no CAPTCHA either.
    mount({ ...TURNSTILE, availability: 'full' });
    expect(scripts()).toEqual([]);
  });

  it('asks a guest to sign in at the page’s sign-in path, and loads no CAPTCHA for them', () => {
    const host = render({ ...TURNSTILE, signedInOnly: true, texts: { ...DEFINITION.texts, signIn: 'Members only.' } });
    expect(host.querySelector('form')).toBeNull();
    expect(host.textContent).toContain('Members only.');
    expect(host.querySelector('a')!.getAttribute('href')).toBe(`/pl${FORMS.signInPath}`);
    mount({ ...TURNSTILE, signedInOnly: true });
    expect(scripts()).toEqual([]);
  });

  it('shows the server’s refusal of a full form in place of a send', async () => {
    fetchMock.mockResolvedValue(json(400, { error: 'not_accepting', reason: 'full' }));
    const host = mount(DEFINITION);
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(host.textContent).toContain('Full.');
  });
});
