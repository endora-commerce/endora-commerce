import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { TranslationProvider } from '../../../packages/admin-shell/src/i18n/TranslationProvider';
import type { Bundle } from '../../../packages/admin-shell/src/i18n/types';
import { CategoryTreePicker } from '@endora-commerce/admin-kit/components';

/**
 * R-1 (`admin-kit-surface.md` R6, 2026-08-31): a translation namespace is module
 * knowledge, so every component in `@endora-commerce/admin-kit` renders out of
 * `core`.
 *
 * Two things live here, and the second is the one that outlives this repair.
 *
 * **`CategoryTreePicker`'s copy**, asserted as an operator sees it. Nothing
 * about a missing key is loud — `resolver.ts` returns `` `${scope}.${key}` ``,
 * so a component pointed at a namespace that does not carry its keys renders
 * `core.categoryTreePicker.loading` into the screen and every existing test
 * stays green, because those tests supply a *passthrough* bundle in which the
 * key and its value are the same string. So the bundle here is `_i18n`'s
 * **shipped** one, read off disk, and the assertions name the English and Polish
 * sentences. `AssetPicker` and `AssetUploader` are covered the same way by
 * `kit-asset-picker.test.tsx`, which owns the asset half; this file does not
 * assert them a second time.
 *
 * **The package-wide guard.** `admin-component-contribution.md` §9.3 measured
 * that nothing in this estate reads a translation namespace: `CategoryTreePicker`
 * shipped in the state R6 forbids from Phase 1b until R-1 and was found by a
 * human reading an unrelated diff. §9.3 recommends a `foreign-module-id` check
 * over three populations and that is the owner's call; this is the narrow half
 * of it — every `useTranslation` in the package names `core` — which is cheap,
 * needs no ledger, and is what stops the next one. It reads literal **AST
 * nodes**, so the doc block in which `AssetPicker` and `CategoryTreePicker` each
 * quote the namespace they no longer use is out of the population by
 * construction; a text scan reported both of them, measured.
 */

const REPO_ROOT = resolve(process.cwd(), '..');
const KIT_SOURCE_DIR = join(REPO_ROOT, 'packages/admin-kit/src');

/** `_i18n`'s bundle, which the admin serves under the synthetic `core` scope. */
function coreBundle(language: 'en' | 'pl'): Bundle {
  const raw = readFileSync(
    join(REPO_ROOT, 'packages/modules/_i18n/i18n', `${language}.json`),
    'utf8',
  );
  return { core: JSON.parse(raw) as Record<string, string> };
}

const EN = coreBundle('en');
const PL = coreBundle('pl');

function renderInCore(ui: ReactElement, language: 'en' | 'pl'): ReturnType<typeof render> {
  const bundle = language === 'en' ? EN : PL;
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <TranslationProvider language={language} initialBundle={bundle}>
      <>{children}</>
    </TranslationProvider>
  );
  return render(ui, { wrapper });
}

/** Every unresolved key renders as `core.<key>`; nothing else in the admin does. */
function expectNoRawKeys(container: HTMLElement): void {
  expect(container.innerHTML).not.toMatch(/\bcore\.[a-zA-Z]/);
}

const CATEGORIES = [
  {
    id: 'parent-1',
    parentCategoryId: null,
    name: { 'en-US': 'Parent One' },
    slug: 'parent-one',
    sortOrder: 1,
  },
  {
    id: 'child-1',
    parentCategoryId: 'parent-1',
    name: { 'en-US': 'Child Leaf' },
    slug: 'child-leaf',
    sortOrder: 1,
  },
];

function kitSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) kitSources(full, out);
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('R-1 — the kit names no translation namespace but `core`', () => {
  it('holds for every `useTranslation` in the package', () => {
    // `src/i18n/` is the hook's own home: it declares the `scope` parameter and
    // documents it with a module id, so it is exempt by exact path — the
    // `check:diacritic-folds` shape, one path and never a filename rule.
    const sources = kitSources(KIT_SOURCE_DIR).filter(
      (file) => !file.startsWith(`${join(KIT_SOURCE_DIR, 'i18n')}/`),
    );
    expect(sources.length).toBeGreaterThan(0);

    const foreign: string[] = [];
    let sites = 0;
    for (const file of sources) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'useTranslation'
        ) {
          sites += 1;
          const [arg] = node.arguments;
          // A computed scope is a finding and not a skip: an argument this
          // cannot read agrees with everything (issue #113).
          const scope =
            arg !== undefined && ts.isStringLiteral(arg) ? arg.text : '<not a literal>';
          if (scope !== 'core') {
            foreign.push(`${file.slice(REPO_ROOT.length + 1)} → ${scope}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    // A changed call shape would otherwise report a clean result over an
    // unwatched package — `check:subscribe-seam`'s worker-half reasoning.
    expect(sites).toBeGreaterThan(0);
    expect(foreign).toEqual([]);
  });

  it('renders `CategoryTreePicker` from the shipped `core` bundle, in both languages', () => {
    const en = renderInCore(
      <CategoryTreePicker categories={CATEGORIES} selectedIds={[]} onChange={(): void => {}} />,
      'en',
    );
    expect(screen.getByPlaceholderText('Filter categories…')).toBeTruthy();
    expect(screen.getByRole('tree', { name: 'Catalog category tree' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Expand branch' }).length).toBeGreaterThan(0);
    expectNoRawKeys(en.container);
    en.unmount();

    const loading = renderInCore(
      <CategoryTreePicker
        categories={[]}
        selectedIds={[]}
        onChange={(): void => {}}
        loading
      />,
      'en',
    );
    expect(screen.getByText('Loading categories…')).toBeTruthy();
    expectNoRawKeys(loading.container);
    loading.unmount();

    const pl = renderInCore(
      <CategoryTreePicker categories={[]} selectedIds={[]} onChange={(): void => {}} />,
      'pl',
    );
    expect(screen.getByPlaceholderText('Filtruj kategorie…')).toBeTruthy();
    expect(screen.getByText('Brak kategorii w katalogu.')).toBeTruthy();
    expectNoRawKeys(pl.container);
    pl.unmount();
  });
});
