import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { TranslationProvider } from '../../../src/i18n/TranslationProvider';
import type { Bundle } from '../../../src/i18n/types';
import {
  PageBuilderHeaderActions,
  PageBuilderTemplateActions,
} from '../../../src/modules/cms/components/PageBuilderHeaderActions';

/**
 * Feature 091 P5a — the shared page-builder chrome renders out of `core`, not
 * out of `cms`' bundle.
 *
 * `PageBuilderHeaderActions.tsx` holds three components that `cms`, `invoices`
 * and `_shared/email-builder` all render, and it takes its `t` as a **prop**, so
 * whose namespace it reads is the caller's decision. Two of the three callers
 * were supplying `useTranslation('cms')` over copy that names `cms` nowhere —
 * which R-1 (`admin-kit-surface.md`, 2026-08-31) rules is module knowledge: the
 * bundle behind a namespace ships in a package the reader neither does nor may
 * depend on, it is resolved at runtime by string, and a missing key renders
 * `<scope>.<key>` into the operator's screen rather than failing to compile.
 *
 * Three things live here, and each of them answers a way this repair can rot.
 *
 * **The key set is derived from the component, never from a prefix.** That is
 * R-1 §9.2's lesson stated as code: `cms`' bundle carries 98 `pageBuilder.*`
 * keys and this file reads 33 of them, so a prefix scan would have moved 65 keys
 * belonging to `cms`' own screens. The walk reads literal AST nodes and a key it
 * cannot read is a **finding**, not a skip (issue #113) — a computed key agrees
 * with everything.
 *
 * **The callers are asserted, not assumed.** A component reading `core` is
 * worth nothing while a caller hands it a `cms` translator, and that hand-off is
 * the whole defect: it compiles, it renders, and it goes wrong only in the copy.
 *
 * **The bundle assertions are against the shipped files, in both languages.**
 * A passthrough bundle — the shape every other test in this directory uses —
 * resolves a key to itself, so it passes whether or not the strings travelled.
 */

const REPO_ROOT = resolve(process.cwd(), '..');
const CHROME_SOURCE = join(
  REPO_ROOT,
  'admin/src/modules/cms/components/PageBuilderHeaderActions.tsx',
);

/** The three files that render a component out of `PageBuilderHeaderActions.tsx`. */
const CALLERS = [
  'admin/src/modules/cms/components/PageBuilderEditor.tsx',
  'admin/src/modules/invoices/templates/InvoiceTemplateEditor.tsx',
  'admin/src/modules/_shared/email-builder/EmailEditorPane.tsx',
];

const CHROME_COMPONENTS = new Set([
  'PageBuilderHeaderActions',
  'PageBuilderTemplateActions',
  'PageBuilderHeaderShell',
]);

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function bundleOf(relative: string, language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, relative, `${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

/** `_i18n`'s bundle, which the admin serves under the synthetic `core` scope. */
function coreBundle(language: 'en' | 'pl'): Bundle {
  return { core: bundleOf('packages/modules/_i18n/i18n', language) };
}

const CORE_EN = bundleOf('packages/modules/_i18n/i18n', 'en');
const CORE_PL = bundleOf('packages/modules/_i18n/i18n', 'pl');
const CMS_EN = bundleOf('packages/modules/cms/i18n', 'en');
const CMS_PL = bundleOf('packages/modules/cms/i18n', 'pl');

/**
 * Every key the chrome reads, taken from its own `t(...)` calls. A call whose
 * first argument is not a string literal is reported rather than skipped.
 */
function chromeKeys(): { keys: string[]; unreadable: string[]; sites: number } {
  const source = parse(CHROME_SOURCE);
  const keys = new Set<string>();
  const unreadable: string[] = [];
  let sites = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
      sites += 1;
      const [arg] = node.arguments;
      if (arg !== undefined && ts.isStringLiteral(arg)) keys.add(arg.text);
      else {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        unreadable.push(`PageBuilderHeaderActions.tsx:${line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return { keys: [...keys].sort(), unreadable, sites };
}

/**
 * The namespace each caller hands the chrome as its `t` prop.
 *
 * Two spellings are resolved, both of which the tree writes: the identifier a
 * `useTranslation('<scope>')` call binds, and one property access over an object
 * literal in the same file whose property holds that identifier —
 * `PageBuilderEditor` keeps its translators on a `useRef` state object and
 * passes `state.<name>`. Anything else reads as `<unresolved>` and fails,
 * because a hand-off this cannot read is the defect it exists to refuse.
 */
function chromeTranslatorScopes(file: string): string[] {
  const full = join(REPO_ROOT, file);
  const source = parse(full);

  const scopeOfIdentifier = new Map<string, string>();
  const propertyInitialiser = new Map<string, ts.Expression>();

  const collect = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'useTranslation'
    ) {
      const [arg] = node.initializer.arguments;
      scopeOfIdentifier.set(
        node.name.text,
        arg !== undefined && ts.isStringLiteral(arg) ? arg.text : '<not a literal>',
      );
    }
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      propertyInitialiser.set(node.name.text, node.initializer);
    }
    if (ts.isShorthandPropertyAssignment(node)) {
      propertyInitialiser.set(node.name.text, node.name);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const resolve = (expression: ts.Expression): string => {
    if (ts.isIdentifier(expression)) return scopeOfIdentifier.get(expression.text) ?? '<unresolved>';
    if (ts.isPropertyAccessExpression(expression)) {
      const held = propertyInitialiser.get(expression.name.text);
      if (held !== undefined && ts.isIdentifier(held)) return resolve(held);
    }
    return '<unresolved>';
  };

  const scopes: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningLikeElement(node)) {
      const tag = node.tagName.getText(source);
      if (CHROME_COMPONENTS.has(tag)) {
        for (const attribute of node.attributes.properties) {
          if (
            ts.isJsxAttribute(attribute) &&
            attribute.name.getText(source) === 't' &&
            attribute.initializer !== undefined &&
            ts.isJsxExpression(attribute.initializer) &&
            attribute.initializer.expression !== undefined
          ) {
            scopes.push(resolve(attribute.initializer.expression));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return scopes;
}

function renderInCore(ui: ReactElement, language: 'en' | 'pl'): ReturnType<typeof render> {
  const bundle = coreBundle(language);
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

describe('P5a — the shared page-builder chrome reads `core`', () => {
  it('reads every one of its keys out of the shipped `core` bundle, in both languages', () => {
    const { keys, unreadable, sites } = chromeKeys();

    // A changed call shape would otherwise report a clean result over an
    // unwatched component — `check:subscribe-seam`'s worker-half reasoning.
    expect(sites).toBeGreaterThan(0);
    expect(unreadable).toEqual([]);
    expect(keys.length).toBeGreaterThan(0);

    expect(keys.filter((key) => !(key in CORE_EN))).toEqual([]);
    expect(keys.filter((key) => !(key in CORE_PL))).toEqual([]);
  });

  it('moved its `pageBuilder.*` keys out of `cms` rather than copying them', () => {
    const { keys } = chromeKeys();
    const pageBuilderKeys = keys.filter((key) => key.startsWith('pageBuilder.'));
    expect(pageBuilderKeys.length).toBeGreaterThan(0);

    expect(pageBuilderKeys.filter((key) => key in CMS_EN)).toEqual([]);
    expect(pageBuilderKeys.filter((key) => key in CMS_PL)).toEqual([]);

    // The three keys with a second reader are the other half of the ruling:
    // `cms`' own editors read them under its namespace, so `cms` keeps its
    // copies and the chrome reads `core`'s equivalents.
    for (const kept of ['common.saving', 'fields.name', 'fields.code']) {
      expect(CMS_EN[kept]).toBeTruthy();
      expect(CMS_PL[kept]).toBeTruthy();
      expect(keys).not.toContain(kept);
    }
  });

  it('is handed a `core` translator by every caller that renders it', () => {
    for (const caller of CALLERS) {
      const scopes = chromeTranslatorScopes(caller);
      expect(scopes.length, `${caller} renders no chrome component`).toBeGreaterThan(0);
      expect(scopes.map((scope) => `${caller} → ${scope}`).filter((entry) => !entry.endsWith('→ core'))).toEqual([]);
    }
  });

  it('renders `PageBuilderHeaderActions` from the shipped bundle, in both languages', () => {
    const en = renderInCore(
      <PageBuilderHeaderActions
        fullscreen={false}
        onToggleFullscreen={(): void => {}}
        currentData={null}
        onClearCanvas={(): void => {}}
        t={(key) => CORE_EN[key] ?? `core.${key}`}
      />,
      'en',
    );
    expect(screen.getAllByRole('button', { name: 'Clear canvas' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Fullscreen' }).length).toBeGreaterThan(0);
    expectNoRawKeys(en.container);
    en.unmount();

    const pl = renderInCore(
      <PageBuilderHeaderActions
        fullscreen
        onToggleFullscreen={(): void => {}}
        currentData={null}
        onClearCanvas={(): void => {}}
        t={(key) => CORE_PL[key] ?? `core.${key}`}
      />,
      'pl',
    );
    expect(screen.getAllByRole('button', { name: 'Wyczyść canvas' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Zamknij pełny ekran' }).length).toBeGreaterThan(0);
    expectNoRawKeys(pl.container);
    pl.unmount();
  });

  it('renders `PageBuilderTemplateActions` from the shipped bundle, in both languages', () => {
    const en = renderInCore(
      <PageBuilderTemplateActions
        currentData={null}
        onSaveAsTemplate={(): void => {}}
        t={(key) => CORE_EN[key] ?? `core.${key}`}
      />,
      'en',
    );
    expect(screen.getAllByRole('button', { name: 'Save as template' }).length).toBeGreaterThan(0);
    expectNoRawKeys(en.container);
    en.unmount();

    const pl = renderInCore(
      <PageBuilderTemplateActions
        currentData={null}
        onSaveAsTemplate={(): void => {}}
        t={(key) => CORE_PL[key] ?? `core.${key}`}
      />,
      'pl',
    );
    expect(screen.getAllByRole('button', { name: 'Zapisz jako szablon' }).length).toBeGreaterThan(0);
    expectNoRawKeys(pl.container);
    pl.unmount();
  });
});
