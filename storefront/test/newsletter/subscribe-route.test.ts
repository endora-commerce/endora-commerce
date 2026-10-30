import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `POST /newsletter/subscribe` — the storefront handler behind
 * `newsletter.Signup` (`specs/163-page-builder-marketing-pages/` T073,
 * contracts/storefront-and-admin-api.md §4, research R-17, FR-029).
 *
 * The backend client and the module presence are stubbed: what is under test
 * is the handler's own decisions — consent, the e-mail, the topic codes, the
 * `returnTo` and anchor it redirects to, the JSON mode and the 404 while the
 * newsletter module is off.
 */

const subscribeNewsletter = vi.fn();
const present = vi.fn((_id: string) => true);

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
  init: { json?: boolean; channel?: string } = {},
): Promise<Response> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (init.json) headers['Accept'] = 'application/json';
  if (init.channel) headers['x-sales-channel'] = init.channel;
  const { POST } = await import('../../app/newsletter/subscribe/route');
  return POST(new Request('http://shop.test/newsletter/subscribe', { method: 'POST', headers, body }));
}

const VALID = { email: 'buyer@example.com', consent: 'on', returnTo: '/landing', anchor: 'signup' };

beforeEach(() => {
  subscribeNewsletter.mockReset();
  subscribeNewsletter.mockResolvedValue({ status: 'pending' });
  present.mockReset();
  present.mockReturnValue(true);
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /newsletter/subscribe', () => {
  it('without consent, redirects back with reason=consent and the anchor, and subscribes nobody', async () => {
    const res = await post({ ...VALID, consent: '' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/landing?newsletter=error&reason=consent#signup');
    expect(subscribeNewsletter).not.toHaveBeenCalled();
  });

  it('without consent, answers 400 JSON when the caller asks for JSON', async () => {
    const { consent: _omit, ...withoutConsent } = VALID;
    const res = await post(withoutConsent, { json: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'consent' });
    expect(subscribeNewsletter).not.toHaveBeenCalled();
  });

  it('refuses an invalid e-mail with reason=email', async () => {
    const res = await post({ ...VALID, email: 'not-an-address' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/landing?newsletter=error&reason=email#signup');
    const json = await post({ ...VALID, email: '' }, { json: true });
    expect(json.status).toBe(400);
    expect(await json.json()).toEqual({ error: 'email' });
    expect(subscribeNewsletter).not.toHaveBeenCalled();
  });

  it('subscribes with the topics, source cms-block and the resolved channel, then redirects with newsletter=pending', async () => {
    const res = await post({ ...VALID, topics: ['offers', 'events'] }, { channel: 'b2c' });
    expect(subscribeNewsletter).toHaveBeenCalledTimes(1);
    expect(subscribeNewsletter).toHaveBeenCalledWith({
      email: 'buyer@example.com',
      channelCode: 'b2c',
      tags: ['offers', 'events'],
      source: 'cms-block',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/landing?newsletter=pending#signup');
  });

  it('answers the outcome as JSON, and active when the backend says so', async () => {
    subscribeNewsletter.mockResolvedValue({ status: 'active' });
    const res = await post(VALID, { json: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'active' });
  });

  it('falls back to the default channel when no channel header is stamped', async () => {
    await post(VALID);
    expect(subscribeNewsletter.mock.calls[0]?.[0]).toMatchObject({ channelCode: 'default' });
  });

  it('keeps the returnTo query, replacing an earlier outcome', async () => {
    const res = await post({ ...VALID, returnTo: '/landing?ref=mail&newsletter=error&reason=email' });
    expect(res.headers.get('location')).toBe('/landing?ref=mail&newsletter=pending#signup');
  });

  it.each([
    ['https://evil.example/', 'another origin'],
    ['//evil.example/path', 'a protocol-relative URL'],
    ['/\\evil.example', 'a backslash path'],
    ['javascript:alert(1)', 'a script URL'],
    ['landing', 'a relative path'],
  ])('falls back to / for a returnTo of %s (%s)', async (returnTo) => {
    const res = await post({ ...VALID, returnTo });
    expect(res.headers.get('location')).toBe('/?newsletter=pending#signup');
  });

  it('omits an anchor outside the anchor pattern', async () => {
    const res = await post({ ...VALID, anchor: 'Bad Anchor"><script>' });
    expect(res.headers.get('location')).toBe('/landing?newsletter=pending');
  });

  it('drops topic codes outside the pattern', async () => {
    await post({ ...VALID, topics: ['offers', 'Bad Code', 'x'.repeat(65), '', 'news_letter-2'] });
    expect(subscribeNewsletter.mock.calls[0]?.[0]).toMatchObject({ tags: ['offers', 'news_letter-2'] });
  });

  it('sends no tags when no topic was chosen', async () => {
    await post(VALID);
    expect(subscribeNewsletter.mock.calls[0]?.[0]).not.toHaveProperty('tags');
  });

  it('refuses with reason=topics when the block requires a topic and none was chosen', async () => {
    const res = await post({ ...VALID, topicsRequired: 'on' });
    expect(res.headers.get('location')).toBe('/landing?newsletter=error&reason=topics#signup');
    expect(subscribeNewsletter).not.toHaveBeenCalled();
  });

  it('reports unavailable when the backend refuses', async () => {
    subscribeNewsletter.mockRejectedValue(new Error('backend down'));
    const res = await post(VALID);
    expect(res.headers.get('location')).toBe('/landing?newsletter=error&reason=unavailable#signup');
    const json = await post(VALID, { json: true });
    expect(json.status).toBe(400);
    expect(await json.json()).toEqual({ error: 'unavailable' });
  });

  // Feature 169 (US7, FR-026, T174): subscriber attributes, described by one
  // `attrSpec` per attribute (`<key>|<type>|<0|1>`) and posted as `attr.<key>`.
  describe('subscriber attributes (feature 169)', () => {
    it('coerces each attribute by its type and passes them as customFields', async () => {
      await post({
        ...VALID,
        attrSpec: ['vip|boolean|0', 'newsletter_ok|boolean|0', 'age|number|0', 'born|date|0', 'company|text|0'],
        'attr.vip': 'on',
        'attr.age': '42',
        'attr.born': '1990-02-28',
        'attr.company': '  Acme  ',
      });
      expect(subscribeNewsletter.mock.calls[0]?.[0]).toMatchObject({
        customFields: { vip: true, newsletter_ok: false, age: 42, born: '1990-02-28', company: 'Acme' },
      });
    });

    it('drops a value its type does not accept, and an empty one', async () => {
      await post({
        ...VALID,
        attrSpec: ['age|number|0', 'born|date|0', 'company|text|0', 'city|text|0'],
        'attr.age': 'abc',
        'attr.born': 'tomorrow',
        'attr.company': 'x'.repeat(501),
        'attr.city': '   ',
      });
      expect(subscribeNewsletter.mock.calls[0]?.[0]).not.toHaveProperty('customFields');
    });

    it('ignores a spec with an invalid key or type', async () => {
      await post({
        ...VALID,
        attrSpec: ['Bad Key|text|0', 'colour|color|0', 'ok|text|0'],
        'attr.Bad Key': 'x',
        'attr.colour': 'red',
        'attr.ok': 'yes',
      });
      expect(subscribeNewsletter.mock.calls[0]?.[0]).toMatchObject({ customFields: { ok: 'yes' } });
    });

    it('reads at most 10 specs', async () => {
      const keys = Array.from({ length: 12 }, (_, i) => `f${i}`);
      const fields: Record<string, string | string[]> = { ...VALID, attrSpec: keys.map((key) => `${key}|text|0`) };
      for (const key of keys) fields[`attr.${key}`] = key;
      await post(fields);
      const customFields = (subscribeNewsletter.mock.calls[0]?.[0] as { customFields: Record<string, unknown> }).customFields;
      expect(Object.keys(customFields)).toEqual(keys.slice(0, 10));
    });

    it('refuses a missing required attribute with reason=fields, as a redirect and as JSON', async () => {
      const fields = { ...VALID, attrSpec: ['company|text|1', 'vip|boolean|1'], 'attr.company': 'Acme' };
      const res = await post(fields);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/landing?newsletter=error&reason=fields#signup');
      const json = await post({ ...fields, 'attr.vip': 'on', 'attr.company': ' ' }, { json: true });
      expect(json.status).toBe(400);
      expect(await json.json()).toEqual({ error: 'fields' });
      expect(subscribeNewsletter).not.toHaveBeenCalled();
    });

    it('accepts a required attribute that is filled in', async () => {
      await post({ ...VALID, attrSpec: ['vip|boolean|1'], 'attr.vip': 'on' });
      expect(subscribeNewsletter.mock.calls[0]?.[0]).toMatchObject({ customFields: { vip: true } });
    });

    it('without attributes, sends the request body of before', async () => {
      await post({ ...VALID, topics: ['offers'] });
      expect(subscribeNewsletter.mock.calls[0]?.[0]).toEqual({
        email: 'buyer@example.com',
        channelCode: 'default',
        tags: ['offers'],
        source: 'cms-block',
      });
    });
  });

  it('answers 404 while the newsletter module is absent, and subscribes nobody', async () => {
    present.mockImplementation((id: string) => id !== 'newsletter');
    const res = await post(VALID);
    expect(res.status).toBe(404);
    expect(present).toHaveBeenCalledWith('newsletter');
    expect(subscribeNewsletter).not.toHaveBeenCalled();
  });
});
