import { describe, expect, it, vi } from 'vitest';
import { pickLanguage, TemplateResolver, type TemplateReader, type TemplateRow } from './template-resolver.js';

/**
 * T020 — which layout a document uses (FR-031, FR-037–FR-039, FR-032) and
 * the channel rule (Constitution XII): a channel's template is chosen only for
 * that channel, and an unresolved channel never selects one.
 */

const TYPE = 'acme.note';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const tree = (marker: string) => ({ root: { props: {} }, content: [{ type: 'acme.Body', props: { marker } }] });
const row = (over: Partial<TemplateRow>): TemplateRow => ({
  id: over.id ?? `id-${Math.random()}`,
  documentType: TYPE,
  salesChannelId: null,
  isDefault: true,
  version: 1,
  content: { schemaVersion: 1, languages: { 'en-US': tree(over.id ?? 'x') } },
  ...over,
});

function reader(rows: TemplateRow[]): TemplateReader & { defaultsCalls: number } {
  const r = {
    defaultsCalls: 0,
    findDefaults: vi.fn(async (type: string, channel: string | null) => {
      r.defaultsCalls += 1;
      return rows.filter(
        (x) => x.documentType === type && x.isDefault && (x.salesChannelId === null || x.salesChannelId === channel),
      );
    }),
    findById: vi.fn(async (id: string) => rows.find((x) => x.id === id) ?? null),
    findApplicable: vi.fn(async (type: string, channel: string | null) =>
      rows.filter((x) => x.documentType === type && (x.salesChannelId === null || (channel !== null && x.salesChannelId === channel))),
    ),
  };
  return r;
}

const builtIn = { schemaVersion: 1 as const, languages: { 'en-US': tree('built-in'), 'pl-PL': tree('wbudowany') } };
const resolve = (rows: TemplateRow[], input: { channel: string | null; language?: string; templateId?: string; selection?: 'default_only' | 'per_document' }) => {
  const r = reader(rows);
  const resolver = new TemplateResolver(r);
  return {
    r,
    result: resolver.resolve({
      documentType: TYPE,
      salesChannelId: input.channel,
      language: input.language ?? 'en-US',
      selection: input.selection ?? 'default_only',
      builtIn,
      ...(input.templateId ? { templateId: input.templateId } : {}),
    }),
  };
};
const markers = (candidates: readonly { tree: unknown }[]) =>
  candidates.map((c) => ((c.tree as { content: { props: { marker: string } }[] }).content[0]!.props.marker));

describe('TemplateResolver — default resolution (FR-031)', () => {
  it('orders channel default, global default, then the built-in layout', async () => {
    const { result } = resolve(
      [row({ id: 'global' }), row({ id: 'chanA', salesChannelId: A })],
      { channel: A },
    );
    const out = await result;
    expect(markers(out.candidates)).toEqual(['chanA', 'global', 'built-in']);
    expect(out.candidates.map((c) => c.source)).toEqual(['default', 'default', 'built_in']);
    expect(out.requestedTemplateMissing).toBe(false);
  });

  it('never chooses a non-default template implicitly', async () => {
    const out = await resolve([row({ id: 'draft', isDefault: false })], { channel: A }).result;
    expect(markers(out.candidates)).toEqual(['built-in']);
  });

  it("never uses channel B's default for a document of channel A", async () => {
    const out = await resolve([row({ id: 'chanB', salesChannelId: B }), row({ id: 'global' })], { channel: A }).result;
    expect(markers(out.candidates)).toEqual(['global', 'built-in']);
  });

  it('only a channel-B default and a channel-A document: the built-in layout', async () => {
    const out = await resolve([row({ id: 'chanB', salesChannelId: B })], { channel: A }).result;
    expect(markers(out.candidates)).toEqual(['built-in']);
  });

  it('an unresolved channel never selects a channel template', async () => {
    const out = await resolve([row({ id: 'chanA', salesChannelId: A }), row({ id: 'global' })], { channel: null }).result;
    expect(markers(out.candidates)).toEqual(['global', 'built-in']);
  });

  it('reads the defaults in a single query', async () => {
    const { r, result } = resolve([row({ id: 'global' })], { channel: A });
    await result;
    expect(r.defaultsCalls).toBe(1);
  });

  it('a candidate whose language has no tree contributes its closest one', async () => {
    const out = await resolve([row({ id: 'global' })], { channel: A, language: 'pl-PL' }).result;
    expect(out.candidates[0]!.language).toBe('en-US');
    expect(out.candidates[1]!.language).toBe('pl-PL');
  });
});

describe('TemplateResolver — explicit template (FR-037–FR-039)', () => {
  it('refuses any template for a default_only type', async () => {
    await expect(resolve([row({ id: 'global' })], { channel: A, templateId: 'global' }).result).rejects.toMatchObject({
      code: 'DOCUMENT_TEMPLATE_NOT_SELECTABLE',
      statusCode: 422,
    });
  });

  it('uses a global or own-channel template for a per_document type, ahead of the defaults', async () => {
    const rows = [row({ id: 'pick', isDefault: false, salesChannelId: A }), row({ id: 'global' })];
    const out = await resolve(rows, { channel: A, templateId: 'pick', selection: 'per_document' }).result;
    expect(markers(out.candidates)).toEqual(['pick']);
    expect(out.candidates[0]!.source).toBe('explicit');
  });

  it("refuses a template of another type or of another channel", async () => {
    await expect(
      resolve([row({ id: 'other', documentType: 'acme.other' })], { channel: A, templateId: 'other', selection: 'per_document' }).result,
    ).rejects.toMatchObject({ code: 'DOCUMENT_TEMPLATE_NOT_SELECTABLE' });
    await expect(
      resolve([row({ id: 'chanB', salesChannelId: B })], { channel: A, templateId: 'chanB', selection: 'per_document' }).result,
    ).rejects.toMatchObject({ code: 'DOCUMENT_TEMPLATE_NOT_SELECTABLE' });
  });

  it('a deleted template falls back to the defaults and says so', async () => {
    const out = await resolve([row({ id: 'global' })], { channel: A, templateId: 'gone', selection: 'per_document' }).result;
    expect(markers(out.candidates)).toEqual(['global', 'built-in']);
    expect(out.requestedTemplateMissing).toBe(true);
  });
});

describe('pickLanguage (FR-032)', () => {
  const langs = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, {}]));
  it.each([
    [langs('pl-PL', 'en-US'), 'pl-PL', 'pl-PL'],
    [langs('pl', 'en-US'), 'pl-PL', 'pl'],
    [langs('de-DE', 'en-US'), 'pl-PL', 'en-US'],
    [langs('de-DE', 'en'), 'pl-PL', 'en'],
    [langs('de-DE', 'fr-FR'), 'pl-PL', 'de-DE'],
    [langs('en-GB', 'pl-PL'), 'en-US', 'en-GB'],
  ])('%o for %s picks %s', (languages, wanted, expected) => {
    expect(pickLanguage(languages, wanted)).toBe(expected);
  });
  it('answers null for no languages', () => {
    expect(pickLanguage({}, 'en-US')).toBeNull();
  });
});

describe('TemplateResolver.listChoices (153 contract §5)', () => {
  const choices = (rows: TemplateRow[], channel: string | null) =>
    new TemplateResolver(reader(rows)).listChoices({ documentType: TYPE, salesChannelId: channel, builtIn });
  const named = (id: string, name: string, over: Partial<TemplateRow> = {}) => row({ id, name, isDefault: false, ...over });

  it('answers global and same-channel templates, never another channel’s — channel first, then global, by name', async () => {
    const out = await choices(
      [
        named('g2', 'Zeta'),
        named('a1', 'Beta', { salesChannelId: A }),
        named('g1', 'Alpha'),
        named('b1', 'Other channel', { salesChannelId: B }),
        named('a2', 'Alpha A', { salesChannelId: A }),
        named('x', 'Other type', { documentType: 'acme.other' }),
      ],
      A,
    );
    expect(out.templates.map((t) => t.id)).toEqual(['a2', 'a1', 'g1', 'g2']);
    expect(out.templates[0]).toEqual({ id: 'a2', name: 'Alpha A', salesChannelId: A, languages: ['en-US'], isDefault: false });
    expect(out.builtInLanguages).toEqual(['en-US', 'pl-PL']);
  });

  it('effectiveDefaultId: the channel default, else the global default, else null (built-in)', async () => {
    const both = [named('g', 'G', { isDefault: true }), named('a', 'A', { salesChannelId: A, isDefault: true })];
    expect((await choices(both, A)).effectiveDefaultId).toBe('a');
    expect((await choices([named('g', 'G', { isDefault: true })], A)).effectiveDefaultId).toBe('g');
    expect((await choices([named('g', 'G')], A)).effectiveDefaultId).toBeNull();
  });

  it('a null channel answers global templates only', async () => {
    const out = await choices([named('g', 'G'), named('a', 'A', { salesChannelId: A, isDefault: true })], null);
    expect(out.templates.map((t) => t.id)).toEqual(['g']);
    expect(out.effectiveDefaultId).toBeNull();
  });
});
