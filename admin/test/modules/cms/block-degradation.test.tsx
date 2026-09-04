import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { render } from '@testing-library/react';
import { Puck, usePuck, type Config } from '@measured/puck';
import { countBlockNames, isNamespaced, ownerOf } from '@endora-commerce/page-builder-core';
import {
  defaultPageBuilderConfig,
  withMissingBlockPlaceholders,
} from '@endora-commerce/cms-components';

/**
 * Feature 096, T602/T603/T605 — a stored block whose owner is absent shows the
 * admin placeholder that names the missing module, and keeps its props.
 *
 * Spec: `specs/096-page-builder-block-ownership/spec.md` User Story 4,
 * FR-019 and FR-020. The storefront half is
 * `storefront/test/ssr/block-degradation.test.tsx`; the half that drives a real
 * module switch is `backend/test/integration/cms/block-owner-off-state.test.ts`.
 *
 * ## Why the placeholder had to be given a name to say
 *
 * Until this phase the admin merged a placeholder for exactly one population:
 * a name the **descriptor** declares whose React renderer this bundle does not
 * carry. That is the narrower of the two cases and not the one Constitution
 * XVII produces — a switched-off module's blocks are filtered *out* of the
 * descriptor (FR-010), so the name an operator's page actually carries after a
 * deactivation was in neither the renderer map nor the descriptor, and the
 * editor merged nothing for it. Puck keeps such a node in its state (asserted
 * below, because that is the half that was already right) and renders nothing
 * for it, so the block vanished from the canvas with no way to tell it from a
 * block that had been deleted.
 *
 * Two things close that. The stored document is now a **third** source of names
 * for the merge, and the placeholder is built visible: its `isAdminPreview`
 * switch was read from `window.location.search` and nothing in this repository
 * has ever set `?cms_admin=1`, so every placeholder the admin has ever merged
 * rendered an empty `<span>`.
 *
 * ## What is asserted here and what is asserted elsewhere
 *
 * These assertions are over the **merge**, not over a running editor: Puck
 * renders its canvas into an iframe, which jsdom will not paint, so a test that
 * drove the whole editor would assert the chrome and call it the canvas. The
 * merge is the decision this feature makes; the wiring that reaches it is
 * asserted separately below, in the idiom of
 * `admin/test/page-builder-admin/chrome-core-namespace.test.tsx` — a repair
 * that is right and unreachable is worth nothing.
 */

const COMPONENTS = (defaultPageBuilderConfig.components ?? {}) as Record<string, unknown>;

/** A well-formed namespaced name whose owner module is not installed here. */
const ABSENT_OWNER_NAME = 'acme.Banner';

/**
 * A name no module declares and the migration therefore leaves byte-identical
 * (FR-014). Synthetic by construction — every bare name this platform has ever
 * persisted is in the frozen rename map's domain, so an unrecognised one is
 * precisely a name that is not. That this one genuinely is unrecognised is
 * asserted where the map and the registry can both be read, in the backend
 * test named above.
 */
const UNRECOGNISED_NAME = 'LegacyPromoBanner';

/** The subject document: one renderable block and the two absent ones. */
function storedDocument(known: string): Record<string, unknown> {
  return {
    root: { props: {} },
    content: [
      { type: known, props: { id: 'kept' } },
      { type: ABSENT_OWNER_NAME, props: { id: 'gone', headline: 'Acme headline', slots: 3 } },
      { type: UNRECOGNISED_NAME, props: { id: 'legacy', headline: 'Legacy headline' } },
    ],
    zones: {},
  };
}

/** The first palette block by sorted name — the "still renders" control. */
const KNOWN_BLOCK = Object.keys(COMPONENTS).sort()[0]!;

/**
 * The names a stored document carries, through the one structural walk this
 * repository has (`countBlockNames`) — the same call the editor makes, so the
 * test and the editor cannot come to disagree about which nodes exist.
 */
function storedNames(document: unknown): string[] {
  return [...countBlockNames(document).keys()];
}

function renderPlaceholder(config: Config, name: string): string {
  const entry = (config.components as Record<string, { render: unknown; defaultProps?: object }>)[
    name
  ]!;
  return renderToString(
    createElement(entry.render as never, { ...(entry.defaultProps ?? {}), puck: {} } as never),
  );
}

function Spy({ sink }: { sink: { data?: unknown } }): null {
  const { appState } = usePuck();
  sink.data = appState.data;
  return null;
}

describe('admin degradation for a block whose owner is absent (FR-019, FR-020)', () => {
  it('has a palette to merge into', () => {
    // Exit-2 reasoning applied to a test: every assertion below is about the
    // difference between a name the config keys and a name it does not.
    expect(Object.keys(COMPONENTS).length).toBeGreaterThan(1);
    expect(KNOWN_BLOCK).toBeTypeOf('string');
  });

  it('merges a placeholder naming the missing module, and leaves known names alone (T602)', () => {
    const merged = withMissingBlockPlaceholders(defaultPageBuilderConfig, storedNames(storedDocument(KNOWN_BLOCK)));

    // The known block keeps its own renderer, identically.
    expect(merged.components![KNOWN_BLOCK]).toBe(COMPONENTS[KNOWN_BLOCK]);
    // The absent one gains a placeholder.
    expect(merged.components![ABSENT_OWNER_NAME]).toBeDefined();

    const html = renderPlaceholder(merged, ABSENT_OWNER_NAME);
    expect(html).toContain(ABSENT_OWNER_NAME);
    // The operator has to be able to tell *why* the block vanished, which is
    // the module's name and nothing else on this screen can supply it.
    expect(html).toContain(ownerOf(ABSENT_OWNER_NAME)!);
    expect(html.trim()).not.toBe('');
  });

  it('gives an unrecognised name the same placeholder path (T605, FR-020)', () => {
    const merged = withMissingBlockPlaceholders(defaultPageBuilderConfig, storedNames(storedDocument(KNOWN_BLOCK)));

    expect(isNamespaced(ABSENT_OWNER_NAME)).toBe(true);
    expect(isNamespaced(UNRECOGNISED_NAME)).toBe(false);
    expect(merged.components![UNRECOGNISED_NAME]).toBeDefined();

    const html = renderPlaceholder(merged, UNRECOGNISED_NAME);
    expect(html).toContain(UNRECOGNISED_NAME);
    // Same path, and the one thing that differs is the one thing the name
    // itself does not say: there is no owner module to name.
    expect(ownerOf(UNRECOGNISED_NAME)).toBeNull();
    expect(html.trim()).not.toBe('');
  });

  it('adds nothing to the palette an operator can insert (FR-010)', () => {
    const merged = withMissingBlockPlaceholders(defaultPageBuilderConfig, storedNames(storedDocument(KNOWN_BLOCK)));
    const insertable = Object.values(merged.categories ?? {}).flatMap((c) => c.components ?? []);

    // A degraded block is renderable so the node stays visible and editable in
    // place; it is not a block anybody may add. The two are different questions
    // and this is the one the palette answers.
    expect(insertable).not.toContain(ABSENT_OWNER_NAME);
    expect(insertable).not.toContain(UNRECOGNISED_NAME);
  });

  it('keeps the block’s props through a save-and-reload (T602, FR-019)', () => {
    const stored = storedDocument(KNOWN_BLOCK);
    const serialised = JSON.stringify(stored);
    const merged = withMissingBlockPlaceholders(defaultPageBuilderConfig, storedNames(stored));
    const sink: { data?: unknown } = {};

    render(
      createElement(
        Puck,
        { config: merged as never, data: stored as never, onPublish: () => {} } as never,
        createElement(Spy, { sink }),
      ),
    );

    // What the editor would save is what it was given: the props of a block
    // nothing can render are not the editor's to drop.
    expect(JSON.stringify(sink.data)).toBe(serialised);
    expect(JSON.stringify(stored)).toBe(serialised);
  });

  it('restores the block on the owner’s return, byte-identically (T603, SC-006)', () => {
    const stored = storedDocument(KNOWN_BLOCK);
    const serialised = JSON.stringify(stored);

    // "The owner is present" is modelled by the renderer being in the map, and
    // "absent" by its withdrawal — which is what a presence-filtered descriptor
    // produces one layer up, and is driven for real in the backend test.
    const present = {
      ...defaultPageBuilderConfig,
      components: { ...COMPONENTS, [ABSENT_OWNER_NAME]: COMPONENTS[KNOWN_BLOCK] },
    } as Config;

    const before = renderPlaceholder(present, ABSENT_OWNER_NAME);
    const off = renderPlaceholder(withMissingBlockPlaceholders(defaultPageBuilderConfig, storedNames(stored)), ABSENT_OWNER_NAME);
    const after = renderPlaceholder(present, ABSENT_OWNER_NAME);

    expect(off).not.toBe(before);
    expect(after).toBe(before);
    expect(JSON.stringify(stored)).toBe(serialised);
  });

  it('is reached by the editor that has to apply it', () => {
    // The callers are asserted, not assumed: a merge that is right and is
    // called by nobody degrades exactly as badly as no merge at all, and
    // nothing else in this repository would notice.
    const source = readFileSync(
      resolve(import.meta.dirname, '../../../../packages/modules/cms/src/admin/components/PageBuilderEditor.tsx'),
      'utf8',
    );
    expect(source).toContain('withMissingBlockPlaceholders');
  });
});
