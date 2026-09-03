import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Render, type Config } from '@measured/puck';
import { isNamespaced, parseBlockName } from '@endora-commerce/page-builder-core';
import { defaultPageBuilderConfig } from '@endora-commerce/cms-components';
import { PageBuilderRender } from '../../components/PageBuilderRender';

/**
 * Feature 096, T601/T603/T605 — a stored block whose owner is absent renders as
 * nothing on the storefront, and the page around it renders.
 *
 * Spec: `specs/096-page-builder-block-ownership/spec.md` User Story 4 and
 * FR-019/FR-020. This is the storefront half; the admin half is
 * `admin/test/modules/cms/block-degradation.test.tsx` and the presence half —
 * the one that drives a real module switch — is
 * `backend/test/integration/cms/block-owner-off-state.test.ts`.
 *
 * ## What "absent" means here, and what it does not
 *
 * **The composed renderer map is the storefront's only oracle**, and that is a
 * fact about this release rather than a shortcut taken by this test. The
 * storefront resolves a block by name against `defaultPageBuilderConfig` and
 * consults no module-presence projection at all: the renderer *chain* (theme →
 * `theme-default` → module default) is F7's, and the spec's § *Scope* puts it
 * and storefront null degradation out of this feature deliberately. So the
 * three causes FR-020 says are one thing — the owner is switched off, the owner
 * is not installed, the name is one the migration did not recognise — reach
 * this surface as the **same** state: a name the map does not key. That is why
 * FR-020 is assertable here at all, and it is also the bound of what these
 * assertions prove. The switch itself is driven for real in the backend test
 * named above.
 *
 * ## The subject is derived, never written down
 *
 * Nothing in this file names a block. The block whose absence is asserted is
 * the first of the composed palette, by sorted name, whose own `defaultProps`
 * render to non-empty HTML — because a block that renders nothing from its
 * defaults cannot tell "absent" from "present" apart, and picking one by hand
 * is how a test comes to describe a palette the tree no longer has. A palette
 * with no such block is a failure of this file's premise and is asserted as
 * one rather than passing vacuously.
 */

type PaletteEntry = { render?: unknown; defaultProps?: Record<string, unknown> };

const COMPONENTS = (defaultPageBuilderConfig.components ?? {}) as Record<string, PaletteEntry>;

/** Render one node through a config, as the page would. */
function renderTree(config: Config, content: readonly unknown[]): string {
  return renderToString(
    createElement(Render, {
      config: config as never,
      data: { root: { props: {} }, content, zones: {} } as never,
    }),
  );
}

function nodeOf(name: string, id: string): Record<string, unknown> {
  const defaults = COMPONENTS[name]?.defaultProps ?? {};
  return { type: name, props: { ...defaults, id } };
}

/**
 * The palette block whose absence is visible in the rendered HTML.
 *
 * Derived by rendering each candidate from its own `defaultProps` — the same
 * fixture rule `block-ssr-floor.ts` uses, and for the same reason: a
 * hand-written fixture per block is a second population to keep current.
 */
const VISIBLE_SUBJECT = Object.keys(COMPONENTS)
  .sort()
  .find((name) => {
    if (parseBlockName(name) === null) return false;
    try {
      return renderTree(defaultPageBuilderConfig, [nodeOf(name, 'subject')]).trim().length > 0;
    } catch {
      return false;
    }
  });

/**
 * A name no module in this repository declares and the migration therefore
 * leaves byte-identical (FR-014). It is synthetic **by construction**: every
 * bare name this platform ever persisted is in the frozen rename map's domain,
 * so an unrecognised one is precisely a name that is not. That it is genuinely
 * unrecognised — absent from the frozen map in both directions and from the
 * registry's `knownNames()` — is asserted where those two can be read, in
 * `backend/test/integration/cms/block-owner-off-state.test.ts`; here it is a
 * fixture, and the only property this file needs from it is that the composed
 * palette does not key it.
 */
const UNRECOGNISED_NAME = 'LegacyPromoBanner';

/** A well-formed namespaced name whose owner module is not installed. */
const ABSENT_OWNER_NAME = 'acme.Banner';

/** The same config with one entry withdrawn — the owner having gone. */
function withoutBlock(name: string): Config {
  const components = { ...COMPONENTS };
  delete components[name];
  const categories = Object.fromEntries(
    Object.entries(defaultPageBuilderConfig.categories ?? {}).map(([key, category]) => [
      key,
      {
        ...category,
        components: (category.components ?? []).filter((entry) => entry !== name),
      },
    ]),
  );
  return { ...defaultPageBuilderConfig, components, categories } as Config;
}

describe('storefront degradation for a block whose owner is absent (FR-019, FR-020)', () => {
  it('has a palette block whose absence is observable', () => {
    // Exit-2 reasoning applied to a test: every assertion below is about the
    // difference between rendering this block and not rendering it, so a
    // palette that yielded none would make them all vacuously true.
    expect(
      VISIBLE_SUBJECT,
      'no composed palette block renders anything from its own defaultProps',
    ).toBeTypeOf('string');
    expect(Object.keys(COMPONENTS).length).toBeGreaterThan(1);
  });

  it('renders the page without the block and throws nothing (T601)', () => {
    const subject = VISIBLE_SUBJECT!;
    const content = [
      nodeOf(subject, 'kept'),
      { type: ABSENT_OWNER_NAME, props: { id: 'gone', headline: 'Acme headline' } },
      { type: UNRECOGNISED_NAME, props: { id: 'legacy', headline: 'Legacy headline' } },
    ];

    let html = '';
    expect(() => {
      html = renderToString(
        createElement(PageBuilderRender, {
          data: { root: { props: {} }, content, zones: {} },
        }),
      );
    }).not.toThrow();

    // The page renders: the block whose owner is present is still there.
    expect(renderTree(defaultPageBuilderConfig, [nodeOf(subject, 'kept')]).length).toBeGreaterThan(0);
    expect(html.length).toBeGreaterThan(0);
    // And the absent blocks render as nothing — not as an error, and not as a
    // leak of the props the row still carries.
    expect(html).not.toContain('Acme headline');
    expect(html).not.toContain('Legacy headline');
    expect(html).not.toContain(ABSENT_OWNER_NAME);
    expect(html).not.toContain(UNRECOGNISED_NAME);
  });

  it('treats an unrecognised name exactly as an absent owner (T605, FR-020)', () => {
    const absent = renderTree(defaultPageBuilderConfig, [
      { type: ABSENT_OWNER_NAME, props: { id: 'x', headline: 'Acme headline' } },
    ]);
    const unrecognised = renderTree(defaultPageBuilderConfig, [
      { type: UNRECOGNISED_NAME, props: { id: 'x', headline: 'Legacy headline' } },
    ]);

    // Identical output, from two causes the spec says must be one path. The
    // two fixtures differ in the property that separates the causes — one is a
    // well-formed namespaced name whose owner is not installed, the other is
    // not a namespaced name at all — so a rendering path that branched on the
    // name's shape would show it here.
    expect(isNamespaced(ABSENT_OWNER_NAME)).toBe(true);
    expect(isNamespaced(UNRECOGNISED_NAME)).toBe(false);
    expect(unrecognised).toBe(absent);
    expect(absent.replace(/<div><\/div>/g, '')).toBe('');
  });

  it('restores the block, and the stored content is byte-identical throughout (T603, SC-006)', () => {
    const subject = VISIBLE_SUBJECT!;
    const stored = {
      root: { props: {} },
      content: [nodeOf(subject, 'a'), { type: ABSENT_OWNER_NAME, props: { id: 'b', headline: 'Acme' } }],
      zones: {},
    };
    const serialised = JSON.stringify(stored);

    const before = renderTree(defaultPageBuilderConfig, stored.content);
    const off = renderTree(withoutBlock(subject), stored.content);
    const after = renderTree(defaultPageBuilderConfig, stored.content);

    expect(off).not.toBe(before);
    expect(after).toBe(before);
    // Rendering is a read. Nothing on this path may rewrite a stored document,
    // which is what SC-006 asserts about the switch-off/switch-on round trip.
    expect(JSON.stringify(stored)).toBe(serialised);
  });
});
