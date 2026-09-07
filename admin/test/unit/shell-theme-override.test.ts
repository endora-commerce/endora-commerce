/**
 * A client changes the admin's palette with no shell file in their tree
 * (feature 110, T126;
 * `specs/110-instance-repository/contracts/admin-stylesheet-composition.md` R3).
 *
 * ## What moved, and why a guard is the deliverable
 *
 * Until T126 the `@theme inline` block, the `:root` and `.dark` token
 * declarations, the `@layer base` rules and the 22-class `@layer components`
 * shim all sat in `admin/src/index.css` — a file an **instance** holds. Under
 * D-207 a client depends on `@endora-commerce/admin-shell`; they do not fork it.
 * So a client scaffolded from that file held the definition of classes the
 * module packages they install actually *render*, frozen at the moment they were
 * scaffolded: a module release adding `.badge--info` would have rendered
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
 * sources are found the way a client's are; and `@endora-commerce/admin-shell`
 * is reached by **name**, through `admin/node_modules`, exactly as a client
 * reaches it through theirs. {@link INSTANCE_FILES} is the whole tree, which is
 * what makes *"with no shell file in their tree"* an assertion rather than a
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
 *  1. the shell's `@theme inline` reached the fixture: `.bg-primary` is emitted,
 *     and it carries the **indirection** R3.2 names (`hsl(var(--primary))`)
 *     rather than a baked literal. A utility this package's build never saw is
 *     what resolves against the client's `:root`, and if the token were inlined
 *     as a value the whole seam would be gone;
 *  2. the `@layer components` shim travelled with it: `.badge--warning`, one of
 *     the 22 classes a module package renders and no instance should define;
 *  3. the client's redeclaration **wins** — the last `--primary` in the emitted
 *     cascade is theirs;
 *  4. and in the control instance, which redeclares nothing, it is the shell's
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
 * Under `admin/` so that `@endora-commerce/admin-shell` and `tailwindcss`
 * resolve the way a client's do — up the directory chain into a `node_modules`
 * that holds them — and git-ignored so that the admin's own build does not scan
 * them. `.gitignore` carries the rule; see this file's doc block for the
 * measurement behind it.
 */
const FIXTURE_ROOT = path.join(adminRoot, '.instance-theme-fixture');

/** The shell's own default, as `theme.css` declares it. */
const SHELL_DEFAULT_PRIMARY = '222.2 47.4% 11.2%';
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
    '@import "@endora-commerce/admin-shell/theme.css";',
    ...(override === null ? [] : ['', `:root {`, `  --primary: ${override};`, `}`]),
    '',
  ].join('\n');
}

/**
 * Every file a fixture instance holds — and **none of them is the shell's**,
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
      '// Two classes and no more: one utility, which only the shell\'s `@theme`\n' +
      '// can resolve, and one shim class, which only the shell\'s `@layer\n' +
      '// components` can define. An instance that got neither would build green.\n' +
      'export const Screen = () => (\n' +
      '  <div className="bg-primary">\n' +
      '    <span className="badge badge--warning">warning</span>\n' +
      '  </div>\n' +
      ');\n',
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

describe('the shell publishes its theme and an instance overrides it by redeclaration', () => {
  beforeAll(() => {
    writeInstance(overriding, CLIENT_PRIMARY);
    writeInstance(control, null);
  });

  afterAll(() => {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  });

  it('reaches the shell by name, with no shell file in the instance tree', async () => {
    // The claim T126 is for: what the client holds is these three files.
    expect(INSTANCE_FILES).toEqual(['index.html', 'src/main.tsx', 'src/index.css']);
    expect(stylesheetOf(CLIENT_PRIMARY)).toContain(
      '@import "@endora-commerce/admin-shell/theme.css";',
    );
    expect(stylesheetOf(CLIENT_PRIMARY)).not.toContain('@theme');
    expect(stylesheetOf(CLIENT_PRIMARY)).not.toContain('@layer');

    const css = await compileInstance(overriding);
    expect(css.length).toBeGreaterThan(0);

    // (1) the `@theme inline` block arrived, and the token is an indirection —
    // which is the whole of why a redeclaration can reach a utility the shell
    // compiled without ever seeing this instance (R3.2).
    expect(css).toMatch(/\.bg-primary\s*\{\s*background-color:\s*hsl\(var\(--primary\)\);/);

    // (2) the `@layer components` shim arrived with it. A module package renders
    // this class; nothing in the instance defines it.
    expect(css).toContain('.badge--warning');
  }, 180_000);

  it('lets the instance change the palette, and defaults to the shell when it does not', async () => {
    const [overridden, defaulted] = await Promise.all([
      compileInstance(overriding),
      compileInstance(control),
    ]);

    // (3) the client's redeclaration is last under `:root`, so it is the one
    // that wins — and the shell's default is still there above it, which is what
    // makes this an override rather than a replacement.
    const declared = declarationsUnder(overridden, ':root');
    expect(declared).toEqual([SHELL_DEFAULT_PRIMARY, CLIENT_PRIMARY]);

    // (4) the control, which redeclares nothing, gets the shell's default — and
    // never the client's, which is what stops (3) passing over a stylesheet that
    // carries that value for some other reason.
    const fallback = declarationsUnder(defaulted, ':root');
    expect(fallback).toEqual([SHELL_DEFAULT_PRIMARY]);

    // And the override reaches `:root` alone. A client restyling the light
    // palette has not silently taken the shell's dark one with it.
    expect(declarationsUnder(overridden, '.dark')).toEqual(
      declarationsUnder(defaulted, '.dark'),
    );
    expect(declarationsUnder(overridden, '.dark')).not.toContain(CLIENT_PRIMARY);
  }, 180_000);
});
