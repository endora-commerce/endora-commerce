// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Render, type Config, type Data } from '@puckeditor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `cms.ContactForm` with JavaScript — `specs/169-page-builder-contact-form/` T108, US6
 * acceptance 6: the form checks itself, marks each invalid field (`aria-invalid`,
 * `aria-describedby`) and moves focus to the first; a valid one posts with `fetch` and
 * `Accept: application/json`, keeps what the shopper typed on an error and clears it on success;
 * the outcome is announced in a `role="status"` region.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.ContactForm']?.defaultProps ?? {}) as Record<string, unknown>;

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

function mount(props: Record<string, unknown> = {}): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const content = [{ type: 'cms.ContactForm', props: { ...defaults, id: 'contact-1', ...props } }] as Data['content'];
  act(() =>
    root!.render(
      <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} location={{ path: '/contact', query: {} }}>
        <Render config={config} data={{ root: { props: {} }, content }} />
      </CmsRenderProvider>,
    ),
  );
  return host;
}

const input = <T extends HTMLElement = HTMLInputElement>(host: HTMLElement, name: string) =>
  host.querySelector<T>(`[name="${name}"]`)!;

function type(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  act(() => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit(host: HTMLElement): Promise<void> {
  await act(async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function fillValid(host: HTMLElement): void {
  type(input(host, 'name'), 'Ada');
  type(input(host, 'email'), 'shopper@example.com');
  type(input<HTMLTextAreaElement>(host, 'message'), 'Hello there');
  act(() => input(host, 'privacyConsent').click());
}

describe('cms.ContactForm with JavaScript (T108)', () => {
  it('turns off the browser’s own validation once it can check itself', () => {
    expect(mount().querySelector('form')!.noValidate).toBe(true);
  });

  it('marks every invalid field, describes it and focuses the first, sending nothing', async () => {
    const host = mount({ fields: { phone: { show: true, required: true } } });
    type(input(host, 'email'), 'not-an-address');
    await submit(host);

    expect(fetchMock).not.toHaveBeenCalled();
    for (const name of ['email', 'phone', 'message', 'privacyConsent']) {
      const element = input(host, name);
      expect(element.getAttribute('aria-invalid'), name).toBe('true');
      const describedBy = element.getAttribute('aria-describedby');
      expect(describedBy, name).toBeTruthy();
      expect(document.getElementById(describedBy!)?.textContent, name).toMatch(/\S/);
    }
    expect(input(host, 'name').getAttribute('aria-invalid')).toBeNull();
    expect(document.activeElement).toBe(input(host, 'email'));
    expect((input(host, 'email') as HTMLInputElement).value).toBe('not-an-address');
  });

  it('posts a valid form with fetch and Accept JSON, then shows the success and clears the form', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'sent' }), { status: 200 }));
    const host = mount({ messages: { success: 'Thank you.' } });
    fillValid(host);
    await submit(host);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/forms/contact');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Accept']).toBe('application/json');
    const body = init.body as FormData;
    expect(body.get('email')).toBe('shopper@example.com');
    expect(body.get('message')).toBe('Hello there');
    expect(body.get('privacyConsent')).toBe('on');
    expect(body.get('form')).toBe('contact-1');

    const status = host.querySelector('[role="status"]')!;
    expect(status.textContent).toBe('Thank you.');
    expect(input(host, 'email').value).toBe('');
    expect(input<HTMLTextAreaElement>(host, 'message').value).toBe('');
  });

  it('keeps every typed value and shows the error when the handler refuses', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'unavailable' }), { status: 400 }));
    const host = mount({ messages: { unavailable: 'Not now.' } });
    fillValid(host);
    await submit(host);

    expect(host.querySelector('[role="status"]')!.textContent).toBe('Not now.');
    expect(input(host, 'name').value).toBe('Ada');
    expect(input(host, 'email').value).toBe('shopper@example.com');
    expect(input<HTMLTextAreaElement>(host, 'message').value).toBe('Hello there');
  });

  it('shows the error message on a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const host = mount({ messages: { unavailable: 'Not now.' } });
    fillValid(host);
    await submit(host);
    expect(host.querySelector('[role="status"]')!.textContent).toBe('Not now.');
  });
});
