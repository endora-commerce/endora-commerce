import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `POST /forms/contact` — the storefront handler behind `cms.ContactForm`
 * (`specs/169-page-builder-contact-form/` T105, contracts/contact-form-api.md §3, FR-017,
 * FR-021, FR-022).
 *
 * The backend client, the newsletter client and the module presence are stubbed: what is under
 * test is the handler's own decisions — the block's required keys, the shared contract, the
 * `returnTo`, block id and anchor it redirects to, the JSON mode, the newsletter opt-in and the
 * 404 while `cms` is off.
 */

const submitContactForm = vi.fn();
const subscribeNewsletter = vi.fn();
const present = vi.fn((_id: string) => true);

vi.mock('../../lib/api/contact-form', () => ({
  submitContactForm: (input: unknown) => submitContactForm(input),
}));

vi.mock('../../lib/api/newsletter', () => ({
  subscribeNewsletter: (input: unknown) => subscribeNewsletter(input),
}));

vi.mock('../../lib/api/module-presence', () => ({
  getModulePresence: async () => ({
    isPresent: (id: string) => present(id),
    presentIds: [],
    absentIds: [],
  }),
}));

async function post(
  fields: Record<string, string | string[]>,
  init: { json?: boolean; channel?: string; forwardedFor?: string } = {},
): Promise<Response> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (init.json) headers['Accept'] = 'application/json';
  if (init.channel) headers['x-sales-channel'] = init.channel;
  if (init.forwardedFor) headers['x-forwarded-for'] = init.forwardedFor;
  const { POST } = await import('../../app/forms/contact/route');
  return POST(new Request('http://shop.test/forms/contact', { method: 'POST', headers, body }));
}

const VALID = {
  email: 'shopper@example.com',
  message: 'Hello there',
  privacyConsent: 'on',
  returnTo: '/contact',
  anchor: 'write-to-us',
  form: 'ContactForm-1',
};

beforeEach(() => {
  submitContactForm.mockReset();
  submitContactForm.mockResolvedValue('sent');
  subscribeNewsletter.mockReset();
  subscribeNewsletter.mockResolvedValue({ status: 'pending' });
  present.mockReset();
  present.mockReturnValue(true);
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /forms/contact', () => {
  it('answers 404 while cms is absent, and sends nothing', async () => {
    present.mockImplementation((id: string) => id !== 'cms');
    const res = await post(VALID);
    expect(res.status).toBe(404);
    expect(present).toHaveBeenCalledWith('cms');
    expect(submitContactForm).not.toHaveBeenCalled();
  });

  it('sends the submission for the request channel and redirects back with contact=sent, the block id and the anchor', async () => {
    const res = await post(
      { ...VALID, name: 'Ada', phone: '+48 123', company: 'Acme', subject: 'Offer', choice: 'North', choiceLabel: 'Region' },
      { channel: 'b2c', forwardedFor: '203.0.113.7' },
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/contact?contact=sent&form=ContactForm-1#write-to-us');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(submitContactForm).toHaveBeenCalledTimes(1);
    expect(submitContactForm).toHaveBeenCalledWith({
      submission: {
        email: 'shopper@example.com',
        message: 'Hello there',
        privacyConsent: true,
        marketingConsent: false,
        name: 'Ada',
        phone: '+48 123',
        company: 'Acme',
        subject: 'Offer',
        choiceLabel: 'Region',
        choice: 'North',
        pagePath: '/contact',
      },
      channelCode: 'b2c',
      forwardedFor: '203.0.113.7',
    });
  });

  it('answers JSON when the caller asks for it', async () => {
    const res = await post(VALID, { json: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'sent' });
  });

  it.each([
    ['the e-mail', { email: '' }],
    ['a valid e-mail', { email: 'not-an-address' }],
    ['the message', { message: '' }],
    ['the privacy consent', { privacyConsent: '' }],
    ['a single-line name', { name: 'a\nb' }],
  ])('refuses a submission without %s as invalid and sends nothing', async (_name, patch) => {
    const res = await post({ ...VALID, ...patch });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/contact?contact=error&reason=invalid&form=ContactForm-1#write-to-us');
    const json = await post({ ...VALID, ...patch }, { json: true });
    expect(json.status).toBe(400);
    expect(await json.json()).toEqual({ error: 'invalid' });
    expect(submitContactForm).not.toHaveBeenCalled();
  });

  it("enforces the block's required keys, which the backend does not know", async () => {
    const res = await post({ ...VALID, required: ['name', 'phone'], name: 'Ada' }, { json: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid' });
    expect(submitContactForm).not.toHaveBeenCalled();
    const ok = await post({ ...VALID, required: ['name', 'phone', 'unknown'], name: 'Ada', phone: '123' }, { json: true });
    expect(ok.status).toBe(200);
  });

  it('requires the choice label with a required choice', async () => {
    const res = await post({ ...VALID, required: ['choice'], choiceLabel: 'Region' }, { json: true });
    expect(await res.json()).toEqual({ error: 'invalid' });
  });

  it.each([
    ['https://evil.example/', 'another origin'],
    ['//evil.example/path', 'a protocol-relative URL'],
    ['/\\evil.example', 'a backslash path'],
    ['javascript:alert(1)', 'a script URL'],
  ])('falls back to / for a returnTo of %s (%s)', async (returnTo) => {
    const res = await post({ ...VALID, returnTo });
    expect(res.headers.get('location')).toBe('/?contact=sent&form=ContactForm-1#write-to-us');
    expect(submitContactForm.mock.calls[0]?.[0]).toMatchObject({ submission: { pagePath: '/' } });
  });

  it('keeps the returnTo query, replacing an earlier outcome', async () => {
    const res = await post({ ...VALID, returnTo: '/contact?ref=mail&contact=error&reason=invalid&form=old' });
    expect(res.headers.get('location')).toBe('/contact?ref=mail&contact=sent&form=ContactForm-1#write-to-us');
  });

  it('omits a block id or an anchor outside their patterns', async () => {
    const res = await post({ ...VALID, form: 'bad id"><', anchor: 'Bad Anchor"><script>' });
    expect(res.headers.get('location')).toBe('/contact?contact=sent');
  });

  it.each(['invalid', 'unavailable'] as const)('maps a backend %s to the same reason', async (outcome) => {
    submitContactForm.mockResolvedValue(outcome);
    const res = await post(VALID);
    expect(res.headers.get('location')).toBe(`/contact?contact=error&reason=${outcome}&form=ContactForm-1#write-to-us`);
    const json = await post(VALID, { json: true });
    expect(json.status).toBe(400);
    expect(await json.json()).toEqual({ error: outcome });
  });

  it('reports unavailable when the backend call throws', async () => {
    submitContactForm.mockRejectedValue(new Error('network'));
    const res = await post(VALID, { json: true });
    expect(await res.json()).toEqual({ error: 'unavailable' });
  });

  it('subscribes the address to the newsletter of the channel when the marketing consent is ticked', async () => {
    const res = await post({ ...VALID, marketingConsent: 'on' }, { channel: 'b2c', json: true });
    expect(res.status).toBe(200);
    expect(submitContactForm.mock.calls[0]?.[0]).toMatchObject({ submission: { marketingConsent: true } });
    expect(subscribeNewsletter).toHaveBeenCalledTimes(1);
    expect(subscribeNewsletter).toHaveBeenCalledWith({
      email: 'shopper@example.com',
      channelCode: 'b2c',
      source: 'cms-contact-form',
    });
  });

  it('does not subscribe without the marketing consent, with newsletter absent, or when the message was not sent', async () => {
    await post(VALID);
    present.mockImplementation((id: string) => id !== 'newsletter');
    await post({ ...VALID, marketingConsent: 'on' });
    present.mockReturnValue(true);
    submitContactForm.mockResolvedValue('unavailable');
    await post({ ...VALID, marketingConsent: 'on' });
    expect(subscribeNewsletter).not.toHaveBeenCalled();
  });

  it('still answers sent when the newsletter subscription fails', async () => {
    subscribeNewsletter.mockRejectedValue(new Error('newsletter down'));
    const res = await post({ ...VALID, marketingConsent: 'on' }, { json: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'sent' });
  });

  it('falls back to the default channel when no channel header is stamped', async () => {
    await post(VALID);
    expect(submitContactForm.mock.calls[0]?.[0]).toMatchObject({ channelCode: 'default' });
  });
});
