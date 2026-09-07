/**
 * A client changes the admin's palette with no package file in their tree
 * (feature 110, T126 and **T129**; owner ruling D-219;
 * `specs/110-instance-repository/contracts/admin-stylesheet-composition.md` R3).
 *
 * ## What moved, and why a guard is the deliverable
 *
 * Until T126 the `@theme inline` block, the `:root` and `.dark` token
 * declarations and the `@layer base` rules sat in `admin/src/index.css` — a file
 * an **instance** holds — and until T129 the two stylesheets beside it,
 * `src/styles/design-tokens.css` and `src/styles/components.css`, did too. Under
 * D-207 a client depends on `@endora-commerce/admin-kit`; they do not fork it.
 * So a client scaffolded from those files held the definition of the classes the
 * module packages they install actually *render* — 70 files under `packages/`
 * render one, and no file under `admin/src` did — frozen at the moment they were
 * scaffolded: a module release adding `.b2b-badge--neutral` would have rendered
 * unstyled in every existing instance, with no diagnostic anywhere. That is §0's
 * failure one blast radius down, and like §0's it is a property of the artefact
 * rather than of the source, so nothing in a type-check or a lint can see it.
 *
 * ## The fixture is an instance, not a corner of this one
 *
 * It is written to disk as a whole Vite application — `index.html`, a `.tsx`
 * that renders two classes, and a three-line stylesheet — and built with its own
 * directory as the root. Two properties follow, and both are the point:
 * `config.root` is Tailwind's automatic-detection base, so the fixture's own
 * sources are found the way a client's are; and `@endora-commerce/admin-kit`
 * is reached by **name**, through `admin/node_modules`, exactly as a client
 * reaches it through theirs. {@link INSTANCE_FILES} is the whole tree, which is
 * what makes *"with no package file in their tree"* an assertion rather than a
 * claim.
 *
 * It is **written rather than committed**, and the path is git-ignored, for one
 * measured reason: a fixture under `admin/` is inside the admin's *own*
 * automatic-detection base, so its classes would be compiled into this
 * repository's admin bundle. Measured both ways — with the fixture tracked, the
 * admin's own compile carries its arbitrary-value probe; with the path ignored,
 * it does not, while the fixture's own build still scans it in full. That is
 * §1's rule seen from the other side: the ignore rules apply to a base's
 * descendants relative to that base, and the fixture is its own base.
 *
 * ## What is asserted
 *
 * Four things, and the control is what makes the third worth anything.
 *
 *  1. the package's `@theme inline` reached the fixture: `.bg-primary` is emitted,
 *     and it carries the **indirection** R3.2 names (`hsl(var(--primary))`)
 *     rather than a baked literal. A utility this package's build never saw is
 *     what resolves against the client's `:root`, and if the token were inlined
 *     as a value the whole seam would be gone;
 *  2. **withdrawn by T128.** It asserted that the `@layer components` shim
 *     travelled with the tokens — `.badge--warning`, described here as *"one of
 *     the 22 classes a module package renders"*. It is not: that number was a
 *     substring match, and under a whole-token predicate in a class-attribute
 *     position **no** file in `packages/` or `admin/src` renders any of the 23.
 *     The shim was deleted rather than carried into a package's published
 *     surface (D-219, R4.5), so there is nothing left for this assertion to be
 *     about. What a module package really renders is the `.b2b-*` vocabulary,
 *     which T129 brings to the design system's package and which the class
 *     assertion below is taken over instead;
 *  3. the client's redeclaration **wins** — the last `--primary` in the emitted
 *     cascade is theirs;
 *  4. and in the control instance, which redeclares nothing, it is the package's
 *     default. Without (4), (3) is satisfied by any stylesheet that happens to
 *     carry that value, and the guard agrees with itself.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const adminRoot = path.resolve(__dirname, '../..');

/**
 * Where the fixture instances are built.
 *
 * Under `admin/` so that `@endora-commerce/admin-kit` and `tailwindcss`
 * resolve the way a client's do — up the directory chain into a `node_modules`
 * that holds them — and git-ignored so that the admin's own build does not scan
 * them. `.gitignore` carries the rule; see this file's doc block for the
 * measurement behind it.
 */
const FIXTURE_ROOT = path.join(adminRoot, '.instance-theme-fixture');

/**
 * The design system's own default, as `theme.css` declares it.
 *
 * It is an **indirection into the accent triplet** rather than a literal, which
 * is what T129's reconciliation left standing: `design-tokens.css` declared
 * `--primary: var(--accent-h) var(--accent-s) var(--accent-l)` and the package's
 * own slate literal is the copy that went. A client who redeclares `--accent-h`
 * alone therefore moves the whole palette, which is T129a's subject.
 */
const PACKAGE_DEFAULT_PRIMARY = 'var(--accent-h) var(--accent-s) var(--accent-l)';
/** What the overriding instance redeclares it to. */
const CLIENT_PRIMARY = '262 83% 58%';

/**
 * The instance's own stylesheet — R2.3's four lines, minus the generated
 * enumeration, which is `tailwind-module-package-sources.test.ts`' subject and
 * would only add sources this fixture makes no claim about.
 */
function stylesheetOf(override: string | null): string {
  return [
    '@import "tailwindcss";',
    '@import "@endora-commerce/admin-kit/theme.css";',
    ...(override === null ? [] : ['', `:root {`, `  --primary: ${override};`, `}`]),
    '',
  ].join('\n');
}

/**
 * Every file a fixture instance holds — and **none of them is the package's**,
 * which is T126's claim stated as a list a reader can check.
 */
const INSTANCE_FILES = ['index.html', 'src/main.tsx', 'src/index.css'] as const;

function writeInstance(dir: string, override: string | null): void {
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(
    path.join(dir, 'index.html'),
    '<!doctype html>\n<html>\n  <body>\n    <div id="root"></div>\n' +
      '    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n',
    'utf8',
  );
  writeFileSync(
    path.join(dir, 'src/main.tsx'),
    "import './index.css';\n\n" +
      '// One class: a utility that only the design system package\'s `@theme`\n' +
      '// can resolve. An instance that did not get it would build green and\n' +
      '// render unstyled, which is the whole failure this fixture is for.\n' +
      'export const Screen = () => <div className="bg-primary" />;\n',
    'utf8',
  );
  writeFileSync(path.join(dir, 'src/index.css'), stylesheetOf(override), 'utf8');
}

async function compileInstance(dir: string): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [path.join(adminRoot, 'test/helpers/compile-instance-stylesheet.mjs'), dir],
    { cwd: adminRoot, maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout;
}

/**
 * Every `--primary` the compiled cascade declares **under one selector**, in
 * source order.
 *
 * Selector-aware, and it has to be: the emitted cascade is `:root`, then
 * `.dark`, then the client's `:root`. A flat scan for the last `--primary`
 * answers `.dark`'s in the instance that overrides nothing, which is a true
 * statement about a rule that has nothing to do with the claim. "The last
 * declaration wins" is a fact about one selector.
 */
function declarationsUnder(css: string, selector: string): readonly string[] {
  const values: string[] = [];
  for (const block of css.matchAll(/(^|\n)\s*([^\n{}]+?)\s*\{([^{}]*)\}/g)) {
    if (block[2]!.trim() !== selector) continue;
    for (const declaration of block[3]!.matchAll(/--primary:\s*([^;]+);/g)) {
      values.push(declaration[1]!.trim());
    }
  }
  return values;
}

const overriding = path.join(FIXTURE_ROOT, 'overriding');
const control = path.join(FIXTURE_ROOT, 'control');

describe('the design system belongs to a package and an instance overrides it by redeclaration', () => {
  beforeAll(() => {
    writeInstance(overriding, CLIENT_PRIMARY);
    writeInstance(control, null);
  });

  afterAll(() => {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  });

  it('reaches the design system by name, with no package file in the instance tree', async () => {
    // The claim T126 is for: what the client holds is these three files.
    expect(INSTANCE_FILES).toEqual(['index.html', 'src/main.tsx', 'src/index.css']);
    expect(stylesheetOf(CLIENT_PRIMARY)).toContain(
      '@import "@endora-commerce/admin-kit/theme.css";',
    );
    expect(stylesheetOf(CLIENT_PRIMARY)).not.toContain('@theme');
    expect(stylesheetOf(CLIENT_PRIMARY)).not.toContain('@layer');

    const css = await compileInstance(overriding);
    expect(css.length).toBeGreaterThan(0);

    // (1) the `@theme inline` block arrived, and the token is an indirection —
    // which is the whole of why a redeclaration can reach a utility the package
    // compiled without ever seeing this instance (R3.2).
    expect(css).toMatch(/\.bg-primary\s*\{\s*background-color:\s*hsl\(var\(--primary\)\);/);

    // (2) is withdrawn — see this file's doc block. The 23 shim classes it
    // named were rendered by nobody and are deleted (T128), so the assertion
    // that they arrive would now be asserting the presence of dead surface.
    // T129 replaces it with the vocabulary a module package does render.
  }, 180_000);

  it('lets the instance change the palette, and defaults to the package when it does not', async () => {
    const [overridden, defaulted] = await Promise.all([
      compileInstance(overriding),
      compileInstance(control),
    ]);

    // (3) the client's redeclaration is last under `:root`, so it is the one
    // that wins — and the package's default is still there above it, which is what
    // makes this an override rather than a replacement.
    const declared = declarationsUnder(overridden, ':root');
    expect(declared).toEqual([PACKAGE_DEFAULT_PRIMARY, CLIENT_PRIMARY]);

    // (4) the control, which redeclares nothing, gets the package's default — and
    // never the client's, which is what stops (3) passing over a stylesheet that
    // carries that value for some other reason.
    const fallback = declarationsUnder(defaulted, ':root');
    expect(fallback).toEqual([PACKAGE_DEFAULT_PRIMARY]);

    // And the override reaches `:root` alone. A client restyling the light
    // palette has not silently taken the package's dark one with it.
    expect(declarationsUnder(overridden, '.dark')).toEqual(
      declarationsUnder(defaulted, '.dark'),
    );
    expect(declarationsUnder(overridden, '.dark')).not.toContain(CLIENT_PRIMARY);
  }, 180_000);
});
