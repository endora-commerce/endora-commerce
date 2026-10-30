// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider, type CmsRenderLocation } from './render-context.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` T075, US7, FR-029, research R-17,
 * contracts/blocks.md `newsletter.Signup` — the sign-up that subscribes
 * through the newsletter module.
 *
 * - A plain `<form method="post" action="/newsletter/subscribe">` with the
 *   hidden `returnTo` and `anchor`, so it works without JavaScript.
 * - Topics are a checkbox group of tag codes; the consent is `required` and its
 *   label may hold a link (to the privacy policy).
 * - With JavaScript, a submit without consent shows the error next to the
 *   consent and keeps the typed address (US7 acceptance 1); a valid one posts
 *   with `fetch` and shows the outcome inline.
 * - Without JavaScript, the outcome comes back on the URL
 *   (`?newsletter=pending`) and is in the server HTML.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['newsletter.Signup']?.defaultProps ?? {}) as Record<string, unknown>;

const consentLabel = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'I accept the ' },
        { type: 'text', text: 'privacy policy', marks: [{ type: 'link', attrs: { href: '/privacy-policy' } }] },
      ],
    },
  ],
};

const PROPS = {
  heading: 'Stay in the loop',
  placeholder: 'you@example.com',
  buttonLabel: 'Sign up',
  topics: [
    { label: 'Offers', tagCode: 'offers' },
    { label: 'Events', tagCode: 'events' },
  ],
  consentLabel,
};

/**
 * The sign-up inside a top-level `cms.Section`, whose anchor the form posts
 * back to (plan § Owner ruling 2026-10-23: anchors live on the Section).
 * `sectionAnchor: null` gives a section with no anchor.
 */
function page(props: Record<string, unknown>, location?: CmsRenderLocation, sectionAnchor: string | null = 'signup') {
  const signup = { type: 'newsletter.Signup', props: { ...defaults, id: 'signup-1', ...props } };
  const sectionDefaults = (config.components['cms.Section']?.defaultProps ?? {}) as Record<string, unknown>;
  const content = [
    {
      type: 'cms.Section',
      props: { ...sectionDefaults, id: 'section-1', ...(sectionAnchor ? { anchor: sectionAnchor } : {}), content: [signup] },
    },
  ] as Data['content'];
  return (
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} {...(location ? { location } : {})}>
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>
  );
}

function serverDom(props: Record<string, unknown> = PROPS, location?: CmsRenderLocation, sectionAnchor: string | null = 'signup'): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToString(page(props, location, sectionAnchor));
  return host;
}

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

function clientDom(props: Record<string, unknown> = PROPS, location?: CmsRenderLocation): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(page(props, location)));
  return host;
}

function form(host: HTMLElement): HTMLFormElement {
  const found = host.querySelector('form');
  if (!found) throw new Error('no form rendered');
  return found;
}

function emailInput(host: HTMLElement): HTMLInputElement {
  return host.querySelector<HTMLInputElement>('input[type="email"][name="email"]')!;
}

function consentInput(host: HTMLElement): HTMLInputElement {
  return host.querySelector<HTMLInputElement>('input[type="checkbox"][name="consent"]')!;
}

async function submit(host: HTMLElement): Promise<void> {
  await act(async () => {
    form(host).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function type(input: HTMLInputElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('newsletter.Signup (T075)', () => {
  it('is registered with neutral defaults: no topics, a consent label and the boxed layout', () => {
    expect(config.components['newsletter.Signup']).toBeDefined();
    expect(defaults).toMatchObject({ topics: [], topicsRequired: false, layout: 'boxed' });
    expect(defaults['consentLabel']).toBeTruthy();
    expect(typeof defaults['buttonLabel']).toBe('string');
  });

  it('posts to /newsletter/subscribe with the hidden returnTo and the enclosing section’s anchor', () => {
    const host = serverDom(PROPS, { path: '/landing', query: { ref: 'mail' } });
    const f = form(host);
    expect(f.getAttribute('method')).toBe('post');
    expect(f.getAttribute('action')).toBe('/newsletter/subscribe');
    expect(f.querySelector<HTMLInputElement>('input[type="hidden"][name="returnTo"]')?.value).toBe('/landing?ref=mail');
    expect(f.querySelector<HTMLInputElement>('input[type="hidden"][name="anchor"]')?.value).toBe('signup');
    const email = emailInput(host);
    expect(email.required).toBe(true);
    expect(email.getAttribute('placeholder')).toBe('you@example.com');
    // The e-mail field has a label, not only a placeholder.
    expect(host.querySelector(`label[for="${email.id}"]`)).not.toBeNull();
    expect(f.querySelector('button[type="submit"]')?.textContent).toBe('Sign up');
  });

  it('sends returnTo / when the page location is not known, and no anchor when its section has none', () => {
    const host = serverDom(PROPS, undefined, null);
    expect(host.querySelector<HTMLInputElement>('input[name="returnTo"]')?.value).toBe('/');
    expect(host.querySelector('input[name="anchor"]')).toBeNull();
  });

  it('renders the topics as a labelled checkbox group of tag codes', () => {
    const host = serverDom();
    const group = host.querySelector('fieldset');
    expect(group).not.toBeNull();
    expect(group!.querySelector('legend')?.textContent?.trim()).toBeTruthy();
    const boxes = [...group!.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="topics"]')];
    expect(boxes.map((box) => box.value)).toEqual(['offers', 'events']);
    expect(boxes.map((box) => host.querySelector(`label[for="${box.id}"]`)?.textContent)).toEqual(['Offers', 'Events']);
    // A topic with no valid tag code is not offered.
    const bad = serverDom({ ...PROPS, topics: [{ label: 'Broken', tagCode: 'Not A Code' }] });
    expect(bad.querySelector('input[name="topics"]')).toBeNull();
    expect(bad.querySelector('fieldset')).toBeNull();
  });

  it('marks the topic choice required with a hidden flag when the block asks for one', () => {
    const host = serverDom({ ...PROPS, topicsRequired: true });
    expect(host.querySelector<HTMLInputElement>('input[type="hidden"][name="topicsRequired"]')?.value).toBe('on');
    expect(serverDom().querySelector('input[name="topicsRequired"]')).toBeNull();
  });

  it('renders a required consent checkbox whose label holds the link', () => {
    const host = serverDom();
    const consent = consentInput(host);
    expect(consent.required).toBe(true);
    expect(consent.value).toBe('on');
    const label = host.querySelector(`label[for="${consent.id}"]`);
    expect(label?.textContent).toBe('I accept the privacy policy');
    expect(label?.querySelector('a')?.getAttribute('href')).toBe('/privacy-policy');
  });

  it('with JavaScript, a submit without consent shows the error next to the consent and keeps the e-mail', async () => {
    const host = clientDom();
    type(emailInput(host), 'buyer@example.com');
    await submit(host);
    expect(fetchMock).not.toHaveBeenCalled();
    const consent = consentInput(host);
    expect(consent.getAttribute('aria-invalid')).toBe('true');
    const errorId = consent.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    const error = host.querySelector(`[id="${errorId}"]`);
    expect(error?.textContent?.trim()).toBeTruthy();
    // Next to the consent: in the same consent row as the checkbox.
    expect(error?.closest('.cmsc-pb-signup__consent')).toBe(consent.closest('.cmsc-pb-signup__consent'));
    expect(emailInput(host).value).toBe('buyer@example.com');
  });

  it('with JavaScript, posts the form with fetch and shows the outcome inline, keeping the page', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'pending' }), { status: 200 }));
    const host = clientDom(PROPS, { path: '/landing', query: {} });
    type(emailInput(host), 'buyer@example.com');
    act(() => consentInput(host).click());
    act(() => host.querySelector<HTMLInputElement>('input[name="topics"][value="events"]')!.click());
    await submit(host);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/newsletter/subscribe');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Accept']).toBe('application/json');
    const body = init.body as FormData;
    expect(body.get('email')).toBe('buyer@example.com');
    expect(body.get('consent')).toBe('on');
    expect(body.getAll('topics')).toEqual(['events']);
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent?.trim()).toBe(String((defaults['messages'] as Record<string, string>)['pending']));
  });

  it('with JavaScript, shows the backend refusal next to the field it is about and keeps the e-mail', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'email' }), { status: 400 }));
    const host = clientDom();
    type(emailInput(host), 'buyer@example.com');
    act(() => consentInput(host).click());
    await submit(host);
    const email = emailInput(host);
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector(`[id="${email.getAttribute('aria-describedby')}"]`)?.textContent?.trim()).toBeTruthy();
    expect(email.value).toBe('buyer@example.com');
  });

  it('shows the pending message from ?newsletter=pending without JavaScript', () => {
    const host = serverDom(PROPS, { path: '/landing', query: { newsletter: 'pending' } });
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent?.trim()).toBe(String((defaults['messages'] as Record<string, string>)['pending']));
  });

  it('shows a consent refusal from the URL next to the consent without JavaScript', () => {
    const host = serverDom(PROPS, { path: '/landing', query: { newsletter: 'error', reason: 'consent' } });
    const consent = consentInput(host);
    expect(consent.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector(`[id="${consent.getAttribute('aria-describedby')}"]`)?.textContent?.trim()).toBe(
      String((defaults['messages'] as Record<string, string>)['consent']),
    );
  });

  it('renders the inline layout as a modifier, the boxed one by default', () => {
    expect(serverDom().querySelector('.cmsc-pb-signup--boxed')).not.toBeNull();
    expect(serverDom({ ...PROPS, layout: 'inline' }).querySelector('.cmsc-pb-signup--inline')).not.toBeNull();
  });
});

/**
 * `specs/169-page-builder-contact-form/` US7, FR-025, data-model §4,
 * contracts/blocks.md §5 (T176, T177) — subscriber attributes: up to 10 of
 * the newsletter's custom fields, rendered after the e-mail field and before
 * the topics, by type (boolean → checkbox; number, date, text → that input),
 * each with a hidden `attrSpec` the storefront handler reads. With no
 * attributes the markup is today's, byte for byte.
 */
const STORED = {
  ...PROPS,
  topicsLegend: 'Topics',
  topicsRequired: true,
  emailLabel: 'E-mail address',
  layout: 'inline',
  messages: { pending: 'Check your inbox.', active: 'Subscribed.' },
};

const ATTRIBUTES = [
  { key: 'vip', type: 'boolean', label: 'I am a trade customer' },
  { key: 'age', type: 'number', fieldLabel: 'Age', placeholder: 'Your age', required: true },
  { key: 'born', type: 'date' },
  { key: 'company', type: 'text', label: 'Company', fieldLabel: 'Company name' },
];

function attributeInput(host: HTMLElement, key: string): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>(`input[name="attr.${key}"]`);
}

function labelOf(host: HTMLElement, input: HTMLInputElement | null): string | undefined {
  return input ? host.querySelector(`label[for="${input.id}"]`)?.textContent ?? undefined : undefined;
}

describe('newsletter.Signup subscriber attributes (feature 169, T176)', () => {
  it('without attributes, a stored block renders the markup of before', () => {
    const html = (props: Record<string, unknown>, location?: CmsRenderLocation): string => renderToString(page(props, location));
    // Recorded from the block as it was before feature 169 (base 09d48c47f).
    expect(html(STORED, { path: '/landing', query: {} })).toMatchSnapshot();
    expect(html({ ...STORED, attributes: [] }, { path: '/landing', query: {} })).toBe(html(STORED, { path: '/landing', query: {} }));
  });

  it('renders each attribute by its type, after the e-mail field and before the topics', () => {
    const host = serverDom({ ...PROPS, attributes: ATTRIBUTES });
    const vip = attributeInput(host, 'vip');
    expect(vip?.type).toBe('checkbox');
    expect(vip?.value).toBe('on');
    expect(attributeInput(host, 'age')?.type).toBe('number');
    expect(attributeInput(host, 'born')?.type).toBe('date');
    const company = attributeInput(host, 'company');
    expect(company?.type).toBe('text');
    expect(company?.getAttribute('maxlength')).toBe('500');
    const inputs = [...form(host).querySelectorAll('input:not([type="hidden"])')];
    const at = (input: Element | null): number => inputs.indexOf(input!);
    expect(at(emailInput(host))).toBeLessThan(at(vip));
    expect(at(company)).toBeLessThan(at(host.querySelector('input[name="topics"]')));
  });

  it('labels an attribute with its label, else the field’s own label, else its key', () => {
    const host = serverDom({ ...PROPS, attributes: ATTRIBUTES });
    expect(labelOf(host, attributeInput(host, 'vip'))).toBe('I am a trade customer');
    expect(labelOf(host, attributeInput(host, 'company'))).toBe('Company');
    expect(labelOf(host, attributeInput(host, 'age'))).toContain('Age');
    expect(labelOf(host, attributeInput(host, 'born'))).toBe('born');
    expect(attributeInput(host, 'age')?.getAttribute('placeholder')).toBe('Your age');
    // A box has no placeholder.
    expect(attributeInput(host, 'vip')?.hasAttribute('placeholder')).toBe(false);
  });

  it('marks a required attribute required, with a visible marker', () => {
    const host = serverDom({ ...PROPS, attributes: ATTRIBUTES });
    const age = attributeInput(host, 'age')!;
    expect(age.required).toBe(true);
    expect(host.querySelector(`label[for="${age.id}"] .cmsc-pb-signup__required`)).not.toBeNull();
    expect(attributeInput(host, 'company')!.required).toBe(false);
  });

  it('describes every attribute in a hidden attrSpec the handler reads', () => {
    const host = serverDom({ ...PROPS, attributes: ATTRIBUTES });
    const specs = [...host.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="attrSpec"]')].map((input) => input.value);
    expect(specs).toEqual(['vip|boolean|0', 'age|number|1', 'born|date|0', 'company|text|0']);
  });

  it('skips an attribute with an invalid key or type, and offers at most 10', () => {
    const host = serverDom({
      ...PROPS,
      attributes: [{ key: 'Bad Key', type: 'text' }, { key: 'colour', type: 'color' }, {}, { key: 'ok', type: 'text' }],
    });
    expect([...host.querySelectorAll<HTMLInputElement>('input[name="attrSpec"]')].map((input) => input.value)).toEqual(['ok|text|0']);
    const many = serverDom({ ...PROPS, attributes: Array.from({ length: 12 }, (_, i) => ({ key: `f${i}`, type: 'text' })) });
    expect(many.querySelectorAll('input[name="attrSpec"]')).toHaveLength(10);
  });

  it('with JavaScript, a required attribute left empty is refused with the fields message, before posting', async () => {
    const host = clientDom({ ...PROPS, attributes: ATTRIBUTES, messages: { fields: 'Fill in the marked fields.' } });
    type(emailInput(host), 'buyer@example.com');
    act(() => consentInput(host).click());
    await submit(host);
    expect(fetchMock).not.toHaveBeenCalled();
    const age = attributeInput(host, 'age')!;
    expect(age.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector(`[id="${age.getAttribute('aria-describedby')}"]`)?.textContent).toBe('Fill in the marked fields.');
    expect(emailInput(host).value).toBe('buyer@example.com');
  });

  it('a required box must be ticked', async () => {
    const host = clientDom({ ...PROPS, attributes: [{ key: 'vip', type: 'boolean', required: true }] });
    type(emailInput(host), 'buyer@example.com');
    act(() => consentInput(host).click());
    await submit(host);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(attributeInput(host, 'vip')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('posts the attributes with the form once they are filled in', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'pending' }), { status: 200 }));
    const host = clientDom({ ...PROPS, attributes: ATTRIBUTES });
    type(emailInput(host), 'buyer@example.com');
    type(attributeInput(host, 'age')!, '42');
    act(() => consentInput(host).click());
    await submit(host);
    const body = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(body.get('attr.age')).toBe('42');
    expect(body.getAll('attrSpec')).toHaveLength(4);
  });

  it('the fields message: the block’s own, else the page language’s, else English', () => {
    const location = { path: '/landing', query: { newsletter: 'error', reason: 'fields' } };
    const message = (host: HTMLElement): string | undefined =>
      host.querySelector('.cmsc-pb-signup__attributes .cmsc-pb-signup__error')?.textContent ?? undefined;
    expect(message(serverDom({ ...PROPS, attributes: ATTRIBUTES, messages: { fields: 'Own text.' } }, location))).toBe('Own text.');
    const translated = document.createElement('div');
    translated.innerHTML = renderToString(
      <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} location={location} newsletterSignupText={{ fields: 'Uzupełnij pola.' }}>
        <Render
          config={config}
          data={{ root: { props: {} }, content: [{ type: 'newsletter.Signup', props: { ...defaults, id: 's', ...PROPS, attributes: ATTRIBUTES } }] as Data['content'] }}
        />
      </CmsRenderProvider>,
    );
    expect(message(translated)).toBe('Uzupełnij pola.');
    expect(message(serverDom({ ...PROPS, attributes: ATTRIBUTES }, location))).toBe('Please fill in the required fields.');
  });

  it('keeps today’s defaults: a new block carries no attributes and no fields message', () => {
    expect(defaults).not.toHaveProperty('attributes');
    expect(defaults['messages']).not.toHaveProperty('fields');
  });
});

type FieldShape = {
  type: string;
  max?: number;
  options?: Array<{ value: string }>;
  arrayFields?: Record<string, FieldShape>;
  objectFields?: Record<string, FieldShape>;
  getItemSummary?: (item: Record<string, unknown>, index?: number) => string;
};

describe('newsletter.Signup attribute fields (feature 169, T177)', () => {
  const block = config.components['newsletter.Signup']!;
  const fields = block.fields as unknown as Record<string, FieldShape>;

  async function resolved(props: Record<string, unknown>): Promise<Record<string, FieldShape>> {
    return (await block.resolveFields!({ props: { id: 'x', ...defaults, ...props } } as never, {
      changed: {},
      fields: block.fields,
      lastFields: block.fields,
      lastData: null,
      metadata: {},
      appState: {},
      parent: null,
    } as never)) as unknown as Record<string, FieldShape>;
  }

  it('declares the attributes as an array of at most 10, after the topics and before the consent', () => {
    const attributes = fields['attributes']!;
    expect(attributes.type).toBe('array');
    expect(attributes.max).toBe(10);
    const keys = Object.keys(fields);
    expect(keys.indexOf('attributes')).toBeGreaterThan(keys.indexOf('topicsRequired'));
    expect(keys.indexOf('attributes')).toBeLessThan(keys.indexOf('consentLabel'));
  });

  it('the package’s own item fields: the key as text and the type as a select, then label, placeholder and a required switch', () => {
    const item = fields['attributes']!.arrayFields!;
    expect(Object.keys(item)).toEqual(['key', 'type', 'label', 'placeholder', 'required']);
    expect(item['key']!.type).toBe('text');
    expect(item['type']!.type).toBe('select');
    expect(item['type']!.options!.map((option) => option.value)).toEqual(['text', 'number', 'boolean', 'date']);
    expect(item['label']!.type).toBe('text');
    expect(item['required']!.type).toBe('custom');
  });

  it('names an item by its label, else the field’s label, else its key', () => {
    const summary = fields['attributes']!.getItemSummary!;
    expect(summary({ key: 'company', label: 'Company' })).toBe('Company');
    expect(summary({ key: 'company', fieldLabel: 'Company name' })).toBe('Company name');
    expect(summary({ key: 'company' })).toBe('company');
    expect(summary({})).toBe('Attribute');
  });

  it('hides the placeholder of a box', async () => {
    const placeholder = fields['attributes']!.arrayFields!['placeholder']!;
    expect(placeholder.type).toBe('custom');
    const { attributePlaceholderApplies } = await import('./NewsletterSignupForm.js');
    expect(attributePlaceholderApplies({ attributes: [{ type: 'boolean' }, { type: 'text' }] }, 'attributes[0].placeholder')).toBe(false);
    expect(attributePlaceholderApplies({ attributes: [{ type: 'boolean' }, { type: 'text' }] }, 'attributes[1].placeholder')).toBe(true);
    expect(attributePlaceholderApplies({ attributes: [{}] }, 'attributes[0].placeholder')).toBe(true);
  });

  it('shows the fields message only with attributes, the same field objects each time', async () => {
    const without = await resolved({ attributes: [] });
    expect(Object.keys(without['messages']!.objectFields!)).not.toContain('fields');
    const withAttributes = await resolved({ attributes: [{ key: 'vip', type: 'boolean' }] });
    expect(Object.keys(withAttributes['messages']!.objectFields!)).toContain('fields');
    expect((await resolved({ attributes: [{ key: 'vip', type: 'boolean' }] }))['messages']).toBe(withAttributes['messages']);
    expect((await resolved({}))['messages']).toBe(without['messages']);
    expect(withAttributes['attributes']).toBe(fields['attributes']);
  });
});
