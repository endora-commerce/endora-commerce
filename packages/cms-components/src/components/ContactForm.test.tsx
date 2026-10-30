// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider, type CmsContactFormText, type CmsRenderLocation } from './render-context.js';

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `cms.ContactForm` — `specs/169-page-builder-contact-form/` T107 and T110, FR-015, FR-016,
 * contracts/blocks.md §4, data-model §3.
 *
 * A plain `<form method="post" action="/forms/contact">` over a fixed field set: e-mail,
 * message and the privacy consent always, name shown by default, the rest on request. What the
 * server renders is what a visitor without JavaScript uses, so everything the handler reads —
 * `returnTo`, `anchor`, `form`, `choiceLabel`, the `required` keys and the honeypot — is in it,
 * and so is the outcome the handler put on the URL.
 */

const config = defaultPageBuilderConfig as Config;
const block = config.components['cms.ContactForm'] as ComponentConfig;
const defaults = (block?.defaultProps ?? {}) as Record<string, unknown>;

interface RenderOptions {
  location?: CmsRenderLocation;
  text?: CmsContactFormText;
  sectionAnchor?: string | null;
  localizePath?: (path: string) => string;
}

function html(props: Record<string, unknown> = {}, options: RenderOptions = {}): string {
  const form = { type: 'cms.ContactForm', props: { ...defaults, id: 'contact-1', ...props } };
  const sectionDefaults = (config.components['cms.Section']?.defaultProps ?? {}) as Record<string, unknown>;
  const content = (
    options.sectionAnchor === undefined
      ? [form]
      : [
          {
            type: 'cms.Section',
            props: {
              ...sectionDefaults,
              id: 'section-1',
              ...(options.sectionAnchor ? { anchor: options.sectionAnchor } : {}),
              content: [form],
            },
          },
        ]
  ) as Data['content'];
  return renderToString(
    <CmsRenderProvider
      embeds={{ blocks: {}, templates: {} }}
      {...(options.location ? { location: options.location } : {})}
      {...(options.text ? { contactFormText: options.text } : {})}
      {...(options.localizePath ? { localizePath: options.localizePath } : {})}
    >
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
}

function dom(props: Record<string, unknown> = {}, options: RenderOptions = {}): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html(props, options);
  return host;
}

const named = (host: HTMLElement, name: string) => host.querySelector<HTMLElement>(`[name="${name}"]`);
const labelOf = (host: HTMLElement, name: string) => {
  const control = named(host, name);
  return control ? host.querySelector<HTMLLabelElement>(`label[for="${control.id}"]`) : null;
};
const hidden = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)].map((input) => input.value);

const PRIVACY_LABEL = {
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

describe('cms.ContactForm — server render (T107)', () => {
  it('is registered, and renders name, e-mail, message, the privacy consent and a submit button by default', () => {
    expect(block).toBeDefined();
    const host = dom();
    const form = host.querySelector('form')!;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe('/forms/contact');
    expect(form.className).toContain('cmsc-pb-contact-form');
    for (const name of ['name', 'email', 'message', 'privacyConsent']) expect(named(host, name), name).not.toBeNull();
    for (const name of ['phone', 'company', 'subject', 'choice', 'marketingConsent']) expect(named(host, name), name).toBeNull();
    expect(host.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    expect(named(host, 'message')!.tagName).toBe('TEXTAREA');
    expect(named(host, 'message')!.getAttribute('rows')).toBe('6');
  });

  it('honours show, label, placeholder and required of the optional fields', () => {
    const host = dom({
      fields: {
        phone: { show: true, label: 'Phone number', placeholder: '+48 …', required: true },
        company: { show: true },
        subject: { show: true, required: false },
        name: { show: false },
      },
    });
    expect(named(host, 'name')).toBeNull();
    const phone = named(host, 'phone') as HTMLInputElement;
    expect(phone.type).toBe('tel');
    expect(phone.placeholder).toBe('+48 …');
    expect(phone.required).toBe(true);
    expect(phone.getAttribute('aria-required')).toBe('true');
    expect(labelOf(host, 'phone')!.textContent).toContain('Phone number');
    expect(named(host, 'company')).not.toBeNull();
    expect((named(host, 'subject') as HTMLInputElement).required).toBe(false);
    expect(hidden(host, 'required')).toEqual(['phone']);
  });

  it('never hides or relaxes the e-mail and the message', () => {
    const host = dom({ fields: { email: { show: false, required: false }, message: { show: false, required: false } } });
    const email = named(host, 'email') as HTMLInputElement;
    const message = named(host, 'message') as HTMLTextAreaElement;
    expect(email.required).toBe(true);
    expect(message.required).toBe(true);
    expect((named(host, 'privacyConsent') as HTMLInputElement).required).toBe(true);
    expect(hidden(host, 'required')).toEqual([]);
  });

  it('renders the choice as a select whose first option is the placeholder, and its label as a hidden field', () => {
    const host = dom({
      fields: {
        choice: { show: true, label: 'Region', placeholder: 'Pick a region', options: [{ label: 'North' }, { label: 'South' }] },
      },
    });
    const select = named(host, 'choice') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect([...select.options].map((option) => [option.value, option.textContent])).toEqual([
      ['', 'Pick a region'],
      ['North', 'North'],
      ['South', 'South'],
    ]);
    expect(hidden(host, 'choiceLabel')).toEqual(['Region']);
  });

  it('does not render a choice without a valid option', () => {
    const host = dom({ fields: { choice: { show: true, label: 'Region', options: [{ label: '  ' }] } } });
    expect(named(host, 'choice')).toBeNull();
    expect(hidden(host, 'choiceLabel')).toEqual([]);
  });

  it('lays the fields out in two columns with per-field spans', () => {
    const host = dom({ columns: 2, fields: { name: { show: true, span: 'full' }, phone: { show: true } } });
    const form = host.querySelector('form')!;
    expect(form.className).toContain('cmsc-pb-contact-form--cols-2');
    const fieldOf = (name: string) => named(host, name)!.closest('.cmsc-pb-contact-form__field')!;
    expect(fieldOf('name').className).toContain('cmsc-pb-contact-form__field--full');
    expect(fieldOf('phone').className).not.toContain('cmsc-pb-contact-form__field--full');
    expect(fieldOf('message').className).toContain('cmsc-pb-contact-form__field--full');
    expect(dom().querySelector('form')!.className).not.toContain('--cols-2');
  });

  it('carries the field look and the label position as classes', () => {
    expect(dom().querySelector('form')!.className).toContain('cmsc-pb-contact-form--look-boxed');
    expect(dom({ fieldLook: 'underline' }).querySelector('form')!.className).toContain('cmsc-pb-contact-form--look-underline');
    expect(dom({ fieldLook: 'pill' }).querySelector('form')!.className).toContain('cmsc-pb-contact-form--look-pill');
    expect(dom({ fieldLook: 'neon' }).querySelector('form')!.className).toContain('cmsc-pb-contact-form--look-boxed');
  });

  it('keeps a visually hidden label for assistive technology with labelPosition hidden', () => {
    const host = dom({ labelPosition: 'hidden' });
    const label = labelOf(host, 'email')!;
    expect(label).not.toBeNull();
    expect(label.className).toContain('cmsc-sr-only');
    // The label reads as the placeholder when the editor wrote none.
    expect((named(host, 'email') as HTMLInputElement).placeholder).toBe(label.textContent!.replace(/\*.*$/, '').trim());
  });

  it('gives the inputs their autocomplete tokens', () => {
    const host = dom({ fields: { phone: { show: true }, company: { show: true } } });
    expect(named(host, 'name')!.getAttribute('autocomplete')).toBe('name');
    expect((named(host, 'email') as HTMLInputElement).type).toBe('email');
    expect(named(host, 'email')!.getAttribute('autocomplete')).toBe('email');
    expect(named(host, 'phone')!.getAttribute('autocomplete')).toBe('tel');
    expect(named(host, 'company')!.getAttribute('autocomplete')).toBe('organization');
  });

  it('renders the honeypot off-screen, out of the tab order and hidden from assistive technology', () => {
    const host = dom();
    const trap = named(host, 'website') as HTMLInputElement;
    expect(trap.getAttribute('tabindex')).toBe('-1');
    expect(trap.getAttribute('autocomplete')).toBe('off');
    const wrapper = trap.closest('.cmsc-pb-contact-form__hp')!;
    expect(wrapper.getAttribute('aria-hidden')).toBe('true');
  });

  it('posts the hidden returnTo, the enclosing section anchor and its own block id', () => {
    const host = dom({}, { location: { path: '/contact', query: { ref: 'mail', contact: 'sent', form: 'contact-1' } }, sectionAnchor: 'write-to-us' });
    expect(hidden(host, 'returnTo')).toEqual(['/contact?ref=mail']);
    expect(hidden(host, 'anchor')).toEqual(['write-to-us']);
    expect(hidden(host, 'form')).toEqual(['contact-1']);
    expect(hidden(dom(), 'anchor')).toEqual([]);
    expect(hidden(dom(), 'returnTo')).toEqual(['/']);
  });

  it("posts to the page language's handler", () => {
    const host = dom({}, { localizePath: (path) => `/pl${path}`, location: { path: '/kontakt', query: {} } });
    expect(host.querySelector('form')!.getAttribute('action')).toBe('/pl/forms/contact');
    expect(hidden(host, 'returnTo')).toEqual(['/pl/kontakt']);
  });

  it('shows the outcome from the URL only in the block it is about', () => {
    const sent = { path: '/contact', query: { contact: 'sent', form: 'contact-1' } };
    expect(dom({ messages: { success: 'Thanks, we will reply soon.' } }, { location: sent }).querySelector('[role="status"]')!.textContent).toBe(
      'Thanks, we will reply soon.',
    );
    expect(dom({}, { location: { path: '/contact', query: { contact: 'sent', form: 'another' } } }).querySelector('[role="status"]')!.textContent).toBe('');
    const unavailable = { path: '/contact', query: { contact: 'error', reason: 'unavailable', form: 'contact-1' } };
    expect(dom({ messages: { unavailable: 'Try later.' } }, { location: unavailable }).querySelector('[role="status"]')!.textContent).toBe('Try later.');
    const invalid = { path: '/contact', query: { contact: 'error', reason: 'invalid', form: 'contact-1' } };
    expect(dom({ messages: { error: 'Check the form.' } }, { location: invalid }).querySelector('[role="status"]')!.textContent).toBe('Check the form.');
  });

  it("uses the page language's words when the block sets none, and English without them", () => {
    const text: CmsContactFormText = {
      label: 'Formularz kontaktowy',
      field: { name: 'Imię i nazwisko', email: 'E-mail', message: 'Wiadomość' },
      privacyConsent: 'Akceptuję politykę prywatności.',
      submit: 'Wyślij',
      success: 'Dziękujemy!',
      required: '(wymagane)',
    };
    const polish = dom({}, { text, location: { path: '/kontakt', query: { contact: 'sent', form: 'contact-1' } } });
    expect(polish.querySelector('form')!.getAttribute('aria-label')).toBe('Formularz kontaktowy');
    expect(labelOf(polish, 'name')!.textContent).toBe('Imię i nazwisko');
    expect(labelOf(polish, 'email')!.textContent).toContain('(wymagane)');
    expect(labelOf(polish, 'privacyConsent')!.textContent).toContain('Akceptuję politykę prywatności.');
    expect(polish.querySelector('button[type="submit"]')!.textContent).toBe('Wyślij');
    expect(polish.querySelector('[role="status"]')!.textContent).toBe('Dziękujemy!');

    const english = dom();
    expect(labelOf(english, 'name')!.textContent).toBe('Name');
    expect(english.querySelector('button[type="submit"]')!.textContent).toBe('Send');
    // The block's own words win over the page language's.
    expect(dom({ button: { label: 'Send enquiry' } }, { text }).querySelector('button[type="submit"]')!.textContent).toBe('Send enquiry');
  });

  it('renders a consent label with its link, and the marketing consent on request', () => {
    const host = dom({ privacyConsent: { label: PRIVACY_LABEL }, marketingConsent: { show: true, label: 'Send me offers' } });
    const privacy = labelOf(host, 'privacyConsent')!;
    expect(privacy.querySelector('a')?.getAttribute('href')).toBe('/privacy-policy');
    const marketing = named(host, 'marketingConsent') as HTMLInputElement;
    expect(marketing.type).toBe('checkbox');
    expect(marketing.required).toBe(false);
    expect(labelOf(host, 'marketingConsent')!.textContent).toBe('Send me offers');
  });

  it('renders the submit button through the button look, aligned or stretched', () => {
    const host = dom({ button: { label: 'Go', style: 'dark', fill: 'outline', size: 'large' }, buttonAlign: 'stretch' });
    const button = host.querySelector('button[type="submit"]')!;
    expect(button.className).toContain('cmsc-btn--dark-outline');
    expect(button.className).toContain('cmsc-btn--large');
    expect(button.closest('.cmsc-pb-contact-form__actions')!.className).toContain('cmsc-pb-contact-form__actions--stretch');
  });

  it('never carries a recipient address: the block has no such prop', () => {
    expect(Object.keys(defaults)).not.toContain('recipients');
    expect(Object.keys(block.fields ?? {})).not.toContain('recipients');
  });
});

/** The fields Puck shows for the block's props (contracts/blocks.md §4). */
async function shown(props: Record<string, unknown> = {}): Promise<Fields> {
  return block.resolveFields!(
    { props: { id: 'contact-1', ...defaults, ...props } } as never,
    { parent: null, fields: block.fields, lastFields: block.fields, changed: {}, lastData: null, metadata: {}, appState: {} } as never,
  ) as Promise<Fields>;
}

const nested = (field: unknown): Record<string, unknown> =>
  ((field as { objectFields?: Record<string, unknown> } | undefined)?.objectFields ?? {}) as Record<string, unknown>;

describe('cms.ContactForm — editor fields (T110)', () => {
  it('orders the fields content → layout → style → spacing → visibility', async () => {
    const keys = Object.keys(await shown({ columns: 2 }));
    const order = [
      'fields',
      'privacyConsent',
      'marketingConsent',
      'messages',
      'formLabel',
      'columns',
      'labelPosition',
      'buttonAlign',
      'fieldLook',
      'button',
      'margin',
      'padding',
      'border',
    ];
    expect(keys.filter((key) => order.includes(key))).toEqual(order);
    expect(keys).toContain('hideOn');
  });

  it('hides what does not apply: a hidden field’s settings, spans with one column, the marketing label while off', async () => {
    const one = await shown({ columns: 1, fields: { phone: { show: false } }, marketingConsent: { show: false } });
    const fields = nested(one['fields']);
    expect(Object.keys(nested(fields['phone']))).toEqual(['show']);
    expect(Object.keys(nested(fields['name']))).toEqual(['show', 'label', 'placeholder', 'required']);
    expect(Object.keys(nested(fields['email']))).toEqual(['label', 'placeholder']);
    expect(Object.keys(nested(one['marketingConsent']))).toEqual(['show']);

    const two = await shown({ columns: 2, fields: { phone: { show: true }, choice: { show: true } }, marketingConsent: { show: true } });
    const twoFields = nested(two['fields']);
    expect(Object.keys(nested(twoFields['phone']))).toEqual(['show', 'label', 'placeholder', 'required', 'span']);
    expect(Object.keys(nested(twoFields['email']))).toEqual(['label', 'placeholder', 'span']);
    expect(Object.keys(nested(twoFields['choice']))).toEqual(['show', 'label', 'placeholder', 'required', 'options', 'span']);
    expect(Object.keys(nested(two['marketingConsent']))).toEqual(['show', 'label']);
  });

  it('hands Puck the same field objects for the same props (feature 163 R17)', async () => {
    const first = await shown({ columns: 2, fields: { phone: { show: true } } });
    const second = await shown({ columns: 2, fields: { phone: { show: true } } });
    for (const key of Object.keys(first)) expect(second[key], key).toBe(first[key]);
  });

  it('offers the button look without a link', async () => {
    const button = nested((await shown())['button']);
    expect(Object.keys(button)).not.toContain('link');
    for (const key of ['label', 'style', 'fill', 'size', 'icon', 'iconPosition']) expect(Object.keys(button)).toContain(key);
  });

  it('uses switches for the booleans', async () => {
    const fields = nested((await shown({ fields: { phone: { show: true } } }))['fields']);
    for (const key of ['show', 'required']) {
      expect((nested(fields['phone'])[key] as { metadata?: { pageBuilder?: { toggle?: boolean } } }).metadata?.pageBuilder?.toggle, key).toBe(true);
    }
  });
});
