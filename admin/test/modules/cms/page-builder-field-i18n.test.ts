import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentConfig, Config, Data, Field, Fields } from '@puckeditor/core';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import type { CmsPageBuilderDescriptor } from '@endora-commerce/contracts';
import { PAGE_BUILDER_SHARED_FIELD_KEYS, sharedFieldLabel } from '@endora-commerce/page-builder-core';
import { defaultPageBuilderConfig } from '@endora-commerce/cms-components';
import { buildPageBuilderEditorConfig } from '../../../../packages/modules/cms/src/admin/components/PageBuilderEditor';
import {
  editorDescriptor,
  fieldsPanel,
  mountPageBuilderEditor,
  selectOutlineItem,
  shippedBundles,
  stubEditorApi,
} from './page-builder-editor-harness';

/**
 * Feature 163, T094 — **field labels of the new and reshaped blocks are
 * translatable** (`specs/163-page-builder-marketing-pages/` FR-039, research
 * R-24).
 *
 * A block's field label resolves from `<stem>.fields.<field>.label` and a
 * select or radio option from `<stem>.fields.<field>.options.<value>`, where
 * `<stem>` is the block's `labelKey` without `.label`; a sub-field of an object
 * or array field nests as `<stem>.fields.<field>.fields.<sub>.…`. The keys are
 * looked up in the bundle of the module that **declares** the block (analysis
 * U4) — `catalog`, `blog` and `newsletter` own four of the blocks below. The
 * English label in the config stays the fallback, which is what an unchanged
 * block shows.
 *
 * The config walked is the editor's own (`buildPageBuilderEditorConfig`), so a
 * field the admin replaces with one control is walked as that control.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

afterEach(() => {
  vi.mocked(apiClient.get).mockReset();
});

/** data-model §4: every block that is new or reshaped, with the module that declares it. */
const NEW_AND_RESHAPED: ReadonlyArray<readonly [string, string]> = [
  // T110: the Section container (plan § Owner ruling 2026-10-23).
  ['cms.Section', 'cms'],
  // T158: the Section group (plan § Owner ruling 2026-10-26).
  ['cms.SectionGroup', 'cms'],
  ['cms.Row', 'cms'],
  ['cms.Heading', 'cms'],
  ['cms.Button', 'cms'],
  ['cms.Hero', 'cms'],
  ['cms.FeatureList', 'cms'],
  ['cms.Stats', 'cms'],
  ['cms.Testimonial', 'cms'],
  ['cms.Tabs', 'cms'],
  // Feature 169 (T061): the page navigation.
  ['cms.PageNavigation', 'cms'],
  ['cms.Accordion', 'cms'],
  ['cms.ContentSlider', 'cms'],
  ['cms.NewsletterSignup', 'cms'],
  ['cms.MediaText', 'cms'],
  ['cms.BackgroundPanel', 'cms'],
  ['cms.CtaCard', 'cms'],
  ['cms.Statement', 'cms'],
  ['cms.LinkList', 'cms'],
  ['cms.CarouselImage', 'cms'],
  ['cms.CarouselSplit', 'cms'],
  ['cms.LinkTile', 'cms'],
  ['cms.DownloadTile', 'cms'],
  // T126, T127: extended with a self-hosted file; with art direction, ratio, overlay and caption.
  ['cms.Video', 'cms'],
  ['cms.Image', 'cms'],
  ['catalog.ProductGrid', 'catalog'],
  ['catalog.ProductSlider', 'catalog'],
  ['blog.LatestPosts', 'blog'],
  ['newsletter.Signup', 'newsletter'],
];

const PL = shippedBundles('pl') as Record<string, Record<string, string>>;
const EN = shippedBundles('en') as Record<string, Record<string, string>>;
const descriptor = editorDescriptor() as unknown as CmsPageBuilderDescriptor;

function scoped(bundles: Record<string, Record<string, string>>) {
  return (scope: string, key: string): string => bundles[scope]?.[key] ?? `${scope}.${key}`;
}

function editorConfig(bundles: Record<string, Record<string, string>>): Config {
  const translateInScope = scoped(bundles);
  return buildPageBuilderEditorConfig({
    descriptor,
    context: 'cms',
    t: (key) => translateInScope('cms', key),
    translateInScope,
  });
}

/**
 * R17 (T203, deliberately widened, standing rule 13): **every** block of the
 * CMS palette, not only the new and reshaped ones — the editor shows them side
 * by side, and an English label among Polish ones is a defect whichever block
 * it belongs to.
 */
const ALL_BLOCKS: ReadonlyArray<readonly [string, string]> = descriptor.components
  .filter((entry) => (entry.contexts ?? ['cms']).includes('cms') && entry.name in editorConfig({}).components)
  .map((entry) => [entry.name, entry.ownerModule] as const);

function stemOf(name: string): string {
  const entry = descriptor.components.find((component) => component.name === name);
  if (!entry?.labelKey) throw new Error(`${name} is not declared`);
  return entry.labelKey.replace(/\.label$/, '');
}

/**
 * Props under which the settings a block shows only where they apply are shown
 * (R17: the autoplay interval, the arrows' look, a caption's look, a Custom px…),
 * so their labels are read too. The first is the block's defaults alone.
 */
const SHOWING: ReadonlyArray<Record<string, unknown>> = [
  {},
  {
    autoplay: true, loop: false, controls: { arrows: true, dots: true, disabledArrowLook: 'color', arrowVariant: 'solid' }, caption: 'Caption',
    image: { src: '/a.jpg' }, minHeight: 200, dividers: 'between', useBrandColors: false, source: 'file', gap: 'custom',
    headingSize: 'custom', titleSize: 'custom', headingMaxWidth: 'custom', layout: 'grid',
  },
  {
    source: 'embed', layout: 'carousel', showConsent: true, overlay: { kind: 'gradient' }, provider: 'google', contentMaxWidth: 'custom',
    widthMode: 'custom', textMaxWidth: 'custom', size: 'custom', font: 'custom', iconSize: 'custom', cardPadding: 'custom',
    cardTextPadding: 'custom', cardTitleSize: 'custom', leadSize: 'custom', captionSize: 'custom', labelSize: 'custom',
    valueSize: 'custom', featureTitleSize: 'custom', subheadingSize: 'custom', statementSize: 'custom', titleMaxWidth: 'custom',
    titlePadding: 'custom', panelGap: 'custom', itemGap: 'custom', panelPaddingBottom: 'custom', openItemGap: 'custom',
    cardDivider: 'line', rows: [{}], showDivider: true,
    // R19B: the look options shown only where they apply.
    linkLook: 'icon', hoverImage: { imageSource: 'url', src: '/a.jpg' }, moreLabel: 'More', buttonPlacement: 'inside',
    topics: [{ label: 'A', tagCode: 'a' }], footerButton: { label: 'All', link: { kind: 'url', href: '/' } },
    button: { label: 'Go', link: { kind: 'url', href: '/' }, fill: 'outline', icon: 'download', iconPosition: 'only' },
    // R20F: the text size's Custom px and the hanging indent's text indent, shown only where they apply.
    bodySize: 'custom', titleHangingIcon: true,
    // R21G: a mobile image's tier and the social-proof caption's placement, shown only where they apply.
    mobileSrc: '/m.jpg', socialProof: { caption: 'Caption' },
    // R22I: the columns of 12 (their anchor and gap), the feature text's and the quote's Custom px.
    mediaSpan: 5, imageSpan: 5, featureBodySize: 'custom', quoteSize: 'custom',
    // R23: the raw columns behind the Advanced switch, the eyebrow's Custom px and line height.
    layoutAdvanced: true, eyebrowSize: 'custom',
  },
];

/** The static field set and what `resolveFields` returns for the block's defaults (and {@link SHOWING}) at the top level. */
async function fieldSets(config: ComponentConfig): Promise<Fields[]> {
  const sets: Fields[] = [config.fields ?? {}];
  if (config.resolveFields) {
    for (const showing of SHOWING) {
      const resolved = await config.resolveFields(
        { props: { id: 'pb163-field-i18n', ...(config.defaultProps ?? {}), ...showing } } as never,
        {
          changed: {},
          fields: config.fields ?? {},
          lastFields: config.fields ?? {},
          lastData: null,
          metadata: {},
          appState: {} as never,
          parent: { type: 'root', props: { id: 'root' } } as never,
        },
      );
      sets.push(resolved);
    }
  }
  return sets;
}

interface Finding {
  key: string;
  shown: string | undefined;
  expected: string | undefined;
}

/** The `core` bundle's one translation of a field the page builder owns (R17, T200). */
function sharedKeyOf(raw: Field | undefined): string | undefined {
  const key = sharedFieldLabel(raw)?.key;
  return key ? `pageBuilder.sharedFields.${key}` : undefined;
}

/**
 * Walks the untranslated field set beside the translated one: a label must
 * be the declaring module's key, or — for a field the page builder owns, still
 * carrying its shared label — the `core` bundle's shared key.
 */
function walk(
  raw: Fields,
  shown: Fields,
  base: string,
  bundle: Record<string, string>,
  core: Record<string, string>,
  findings: Finding[],
): void {
  for (const [name, field] of Object.entries(shown) as Array<[string, Field | undefined]>) {
    if (!field || typeof field !== 'object') continue;
    const source = (raw as Record<string, Field | undefined>)[name];
    const shared = sharedKeyOf(source);
    const path = `${base}.fields.${name}`;
    if (typeof field.label === 'string') {
      const variant = (field as { metadata?: { pageBuilder?: { labelKey?: string } } }).metadata?.pageBuilder?.labelKey;
      const key = `${path}.${variant ?? 'label'}`;
      const expected = bundle[key] ?? (shared ? core[`${shared}.label`] : undefined);
      if (expected === undefined || field.label !== expected) {
        findings.push({ key, shown: field.label, expected });
      }
    }
    if ((field.type === 'select' || field.type === 'radio') && Array.isArray(field.options)) {
      for (const option of field.options) {
        const key = `${path}.options.${String(option.value)}`;
        const expected = bundle[key] ?? (shared ? core[`${shared}.options.${String(option.value)}`] : undefined);
        if (expected === undefined || option.label !== expected) {
          findings.push({ key, shown: option.label, expected });
        }
      }
    }
    const nested = (f: Field | undefined): Fields =>
      ((f as { objectFields?: Fields } | undefined)?.objectFields ?? (f as { arrayFields?: Fields } | undefined)?.arrayFields ?? {}) as Fields;
    if (field.type === 'object' || field.type === 'array') walk(nested(source), nested(field), path, bundle, core, findings);
  }
}

async function findingsOf(name: string, owner: string, bundles: Record<string, Record<string, string>>): Promise<Finding[]> {
  const raw = await fieldSets(editorConfig({}).components[name] as ComponentConfig);
  const shown = await fieldSets(editorConfig(bundles).components[name] as ComponentConfig);
  const findings: Finding[] = [];
  shown.forEach((fields, index) => walk(raw[index] ?? {}, fields, stemOf(name), bundles[owner] ?? {}, bundles['core'] ?? {}, findings));
  return [...new Map(findings.map((finding) => [finding.key, finding])).values()];
}

describe('field labels of every block, in Polish (T094, R17 T203)', () => {
  const config = editorConfig(PL);

  it('enumerates the blocks of data-model §4, each declared and rendered', () => {
    for (const [name, owner] of NEW_AND_RESHAPED) {
      const entry = descriptor.components.find((component) => component.name === name);
      expect(entry?.ownerModule, name).toBe(owner);
      expect(config.components[name], name).toBeDefined();
    }
    // R17: and the palette holds more than those — every one of them is walked below.
    expect(ALL_BLOCKS.length).toBeGreaterThan(NEW_AND_RESHAPED.length);
  });

  it.each(ALL_BLOCKS)('%s: every field and option label resolves from %s\'s bundle or the shared one', async (name, owner) => {
    expect(await findingsOf(name, owner, PL)).toEqual([]);
  });

  it('every key a Polish label resolves from has its English sentence', () => {
    for (const [name, owner] of ALL_BLOCKS) {
      const prefix = `${stemOf(name)}.fields.`;
      const pl = Object.keys(PL[owner] ?? {}).filter((key) => key.startsWith(prefix));
      const en = Object.keys(EN[owner] ?? {}).filter((key) => key.startsWith(prefix));
      expect(pl.sort(), name).toEqual(en.sort());
    }
    const shared = (bundle: Record<string, string>): string[] =>
      Object.keys(bundle).filter((key) => key.startsWith('pageBuilder.sharedFields.')).sort();
    expect(shared(PL['core'] ?? {})).toEqual(shared(EN['core'] ?? {}));
    expect(shared(PL['core'] ?? {}).length).toBeGreaterThan(0);
  });

  it('a shared field is translated once: no block keeps a key of its own for it', async () => {
    const repeated: string[] = [];
    const raw = editorConfig({});
    for (const [name, owner] of ALL_BLOCKS) {
      const stem = stemOf(name);
      for (const fields of await fieldSets(raw.components[name] as ComponentConfig)) {
        for (const [key, field] of Object.entries(fields) as Array<[string, Field]>) {
          const shared = sharedFieldLabel(field)?.key;
          if (!shared || !(PAGE_BUILDER_SHARED_FIELD_KEYS as readonly string[]).includes(shared)) continue;
          if (PL[owner]?.[`${stem}.fields.${key}.label`] !== undefined) repeated.push(`${stem}.fields.${key}`);
        }
      }
    }
    expect([...new Set(repeated)]).toEqual([]);
  });

  // T156: a block placed in a Column is offered the shared wrapper's `stackOrder`
  // (resolved with the Column as its parent); its label and options are in the
  // owner's bundle for every block above, `cms.Text` and `cms.RichContent` too.
  // T158 (deliberately changed, standing rule 13): the Section group is top level only too, never in a Column.
  it.each([...NEW_AND_RESHAPED.filter(([name]) => name !== 'cms.Section' && name !== 'cms.SectionGroup'), ['cms.Text', 'cms'], ['cms.RichContent', 'cms']] as const)(
    '%s in a Column: the order field and its options resolve from %s\'s bundle',
    async (name, owner) => {
      const block = config.components[name] as ComponentConfig;
      const resolved = (await block.resolveFields!(
        { props: { id: 'pb163-order', ...(block.defaultProps ?? {}) } } as never,
        {
          changed: {},
          fields: block.fields ?? {},
          lastFields: block.fields ?? {},
          lastData: null,
          metadata: {},
          appState: {} as never,
          parent: { type: 'cms.Column', props: { id: 'pb163-column' } } as never,
        },
      )) as Fields;
      const order = resolved['stackOrder'] as Field | undefined;
      expect(order, name).toBeDefined();
      // R17 (T200, deliberately changed): the order is a shared field, translated once in `core`.
      const raw = (editorConfig({}).components[name] as ComponentConfig).fields ?? {};
      const source = ((await (editorConfig({}).components[name] as ComponentConfig).resolveFields!(
        { props: { id: 'pb163-order', ...(block.defaultProps ?? {}) } } as never,
        { changed: {}, fields: raw, lastFields: raw, lastData: null, metadata: {}, appState: {} as never, parent: { type: 'cms.Column', props: { id: 'pb163-column' } } as never },
      )) as Fields)['stackOrder'];
      const findings: Finding[] = [];
      walk({ stackOrder: source! } as Fields, { stackOrder: order! } as Fields, stemOf(name), PL[owner] ?? {}, PL['core'] ?? {}, findings);
      expect(findings).toEqual([]);
      expect(order!.label).toBe('Kolejność w kolumnie');
    },
  );

  // T159, T165: a Column's order in its Row and its placement in the Row's grid.
  it('cms.Column: the order and placement fields and their options resolve from cms\'s bundle', () => {
    const column = config.components['cms.Column'] as ComponentConfig;
    const fields = column.fields ?? {};
    const picked = Object.fromEntries(
      ['stackOrder', 'rowSpan', 'columnStart', 'rowStart'].map((key) => [key, fields[key]]),
    ) as Fields;
    for (const key of Object.keys(picked)) expect(picked[key], key).toBeDefined();
    const findings: Finding[] = [];
    walk(picked, picked, stemOf('cms.Column'), PL['cms'] ?? {}, PL['core'] ?? {}, findings);
    expect(findings).toEqual([]);
    expect(picked['rowSpan']!.label).toBe('Wysokość w wierszach');
    expect(picked['columnStart']!.label).toBe('Początek w kolumnie');
    expect(picked['rowStart']!.label).toBe('Początek w wierszu');
  });

  // R17 (T203, deliberately changed, standing rule 13): there is no unchanged
  // block left — `cms.Spacer`, the last with no keys, is translated too; its
  // shared field ("Hide on") reads the `core` bundle.
  it('cms.Spacer and the shared fields read Polish', () => {
    const spacer = config.components['cms.Spacer'] as ComponentConfig;
    expect(String((spacer.fields?.['heightPx'] as Field).label)).toBe(PL['cms']?.['blocks.spacer.fields.heightPx.label']);
    expect(String((spacer.fields?.['hideOn'] as Field).label)).toBe(PL['core']?.['pageBuilder.sharedFields.hideOn.label']);
    expect(PL['core']?.['pageBuilder.sharedFields.hideOn.label']).not.toBe(EN['core']?.['pageBuilder.sharedFields.hideOn.label']);
  });

  it('a block\'s own `resolveFields` result is translated, and the same field object comes back each time', async () => {
    const heading = config.components['cms.Heading'] as ComponentConfig;
    const [, first] = await fieldSets(heading);
    const [, second] = await fieldSets(heading);
    expect(first?.['level']?.label).toBe(PL['cms']?.['blocks.heading.fields.level.label']);
    expect(first?.['text']).toBe(second?.['text']);
  });

  // Feature 169 (T016): the accordion's Filled items and the download tile's icon size and style.
  it('feature 169: the accordion\'s Filled option and the download tile\'s icon button size and style read Polish', () => {
    const accordion = (config.components['cms.Accordion'] as ComponentConfig).fields ?? {};
    const itemStyle = accordion['itemStyle'] as { options?: Array<{ label: string; value: unknown }> };
    expect(itemStyle.options?.find((option) => option.value === 'filled')?.label).toBe(PL['cms']?.['blocks.accordion.fields.itemStyle.options.filled']);
    const tile = (config.components['cms.DownloadTile'] as ComponentConfig).fields ?? {};
    for (const key of ['iconButtonSize', 'iconButtonStyle']) {
      const field = tile[key] as { label?: string; options?: Array<{ label: string; value: unknown }> } | undefined;
      expect(field?.label, key).toBe(PL['cms']?.[`blocks.downloadTile.fields.${key}.label`]);
      for (const option of field?.options ?? []) {
        expect(option.label, `${key}.${String(option.value)}`).toBe(PL['cms']?.[`blocks.downloadTile.fields.${key}.options.${String(option.value)}`]);
        expect(option.label).not.toBe(EN['cms']?.[`blocks.downloadTile.fields.${key}.options.${String(option.value)}`]);
      }
    }
    expect(PL['cms']?.['blocks.accordion.fields.itemStyle.options.filled']).not.toBe(EN['cms']?.['blocks.accordion.fields.itemStyle.options.filled']);
  });
});

/**
 * The mounted editor, for one block of each owner the jsdom canvas can select.
 * `catalog`'s listings are asserted on the config above only: selecting
 * `catalog.ProductGrid` in this jsdom mount never settles (a synchronous loop
 * after its category picker's read, observed with and without this feature's
 * label translation), which is outside this task.
 */
describe('the editor shows them (T094)', () => {
  function page(): Data {
    return {
      root: { props: {} },
      content: [
        { type: 'cms.MediaText', props: { id: 'pb163-mt' } },
        { type: 'blog.LatestPosts', props: { id: 'pb163-posts' } },
        { type: 'newsletter.Signup', props: { id: 'pb163-signup' } },
      ],
    } as unknown as Data;
  }

  it.each([
    [0, 'cms', 'blocks.mediaText.fields.headingLevel.label'],
    [1, 'blog', 'blocks.latestPosts.fields.layout.label'],
    [2, 'newsletter', 'blocks.signup.fields.layout.label'],
  ] as const)('outline item %i shows %s\'s %s', async (index, owner, key) => {
    stubEditorApi(vi.mocked(apiClient));
    await mountPageBuilderEditor(page(), { language: 'pl' });
    await selectOutlineItem(index);
    const polish = PL[owner]?.[key];
    expect(polish).toBeDefined();
    expect(polish).not.toBe(EN[owner]?.[key]);
    expect(fieldsPanel()?.textContent ?? '').toContain(polish);
  });
});

/**
 * Feature 169 (US7, T185) — `newsletter.Signup`'s subscriber attributes and the
 * message shown only with them, in Polish from `newsletter`'s bundle, for the
 * admin's pickers and for the package's own item fields alike.
 */
describe('newsletter.Signup attribute fields in Polish (feature 169, T185)', () => {
  async function resolvedWithAttributes(config: Config): Promise<Fields> {
    const block = config.components['newsletter.Signup'] as ComponentConfig;
    return (await block.resolveFields!(
      { props: { id: 'pb169-signup', ...(block.defaultProps ?? {}), attributes: [{ key: 'vip', type: 'boolean' }] } } as never,
      {
        changed: {},
        fields: block.fields ?? {},
        lastFields: block.fields ?? {},
        lastData: null,
        metadata: {},
        appState: {} as never,
        parent: { type: 'root', props: { id: 'root' } } as never,
      },
    )) as Fields;
  }

  it('the attributes, their item fields and the fields message resolve from newsletter\'s bundle', async () => {
    const raw = await resolvedWithAttributes(editorConfig({}));
    const shown = await resolvedWithAttributes(editorConfig(PL));
    const findings: Finding[] = [];
    walk(raw, shown, stemOf('newsletter.Signup'), PL['newsletter'] ?? {}, PL['core'] ?? {}, findings);
    expect(findings).toEqual([]);
    const attributes = shown['attributes'] as { label?: string; arrayFields?: Record<string, Field> };
    expect(attributes.label).toBe(PL['newsletter']?.['blocks.signup.fields.attributes.label']);
    expect(attributes.arrayFields?.['key']?.label).toBe(PL['newsletter']?.['blocks.signup.fields.attributes.fields.key.label']);
    const messages = shown['messages'] as { objectFields?: Record<string, Field> };
    expect(messages.objectFields?.['fields']?.label).toBe(PL['newsletter']?.['blocks.signup.fields.messages.fields.fields.label']);
  });

  it('the package\'s own type select (the editors without the admin\'s picker) reads Polish too', () => {
    const own = (defaultPageBuilderConfig.components['newsletter.Signup'] as ComponentConfig).fields as unknown as Record<
      string,
      { arrayFields?: Record<string, { options?: Array<{ value: string }> }> }
    >;
    const options = own['attributes']?.arrayFields?.['type']?.options ?? [];
    expect(options.length).toBe(4);
    for (const option of options) {
      expect(PL['newsletter']?.[`blocks.signup.fields.attributes.fields.type.options.${option.value}`], option.value).toBeTruthy();
      expect(EN['newsletter']?.[`blocks.signup.fields.attributes.fields.type.options.${option.value}`], option.value).toBeTruthy();
    }
  });
});

/**
 * Feature 169 (T114) — `cms.ContactForm` with every one of its settings shown: each field
 * group open, two columns (the spans), the select's options and the marketing consent's label.
 * The walk above reads the block with its defaults, where most of them are hidden.
 */
describe('cms.ContactForm field labels with every setting shown (feature 169, T114)', () => {
  const SHOWN = {
    columns: 2,
    fields: {
      name: { show: true },
      phone: { show: true },
      company: { show: true },
      subject: { show: true },
      choice: { show: true, options: [{ label: 'A' }] },
    },
    marketingConsent: { show: true },
  };

  async function resolved(config: Config): Promise<Fields> {
    const block = config.components['cms.ContactForm'] as ComponentConfig;
    return (await block.resolveFields!(
      { props: { id: 'pb169-contact', ...(block.defaultProps ?? {}), ...SHOWN } } as never,
      {
        changed: {},
        fields: block.fields ?? {},
        lastFields: block.fields ?? {},
        lastData: null,
        metadata: {},
        appState: {} as never,
        parent: { type: 'root', props: { id: 'root' } } as never,
      },
    )) as Fields;
  }

  it('resolves every label and option from cms\'s bundle or the shared one, in Polish', async () => {
    const findings: Finding[] = [];
    walk(await resolved(editorConfig({})), await resolved(editorConfig(PL)), stemOf('cms.ContactForm'), PL['cms'] ?? {}, PL['core'] ?? {}, findings);
    expect(findings).toEqual([]);
  });
});
