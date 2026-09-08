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
 *  2. the **class vocabulary** arrived with the tokens: `.b2b-btn`, one of the
 *     137 classes 70 files in `packages/` render and no instance should define
 *     (T129, R4.4).
 *
 *     Until T128 this assertion named `.badge--warning`, described here as
 *     *"one of the 22 classes a module package renders"*. It was not: that
 *     number was a **substring** match, and under a whole-token predicate in a
 *     class-attribute position no file in `packages/` or `admin/src` rendered
 *     any of the 23. The shim was deleted rather than carried into a package's
 *     published surface (D-219, R4.5), and the assertion was taken over against
 *     a class a module package really renders;
 *  3. **the token override reaches through the indirection** (T129a). The
 *     instance redeclares `--accent-h` and never names `--primary`, and the
 *     palette moves — which is only true while `--primary` stays
 *     `var(--accent-h) var(--accent-s) var(--accent-l)`. A reconciliation that
 *     had flattened it to a literal would still emit `.bg-primary`, would still
 *     satisfy the control, and would have taken the seam away in silence;
 *  4. **the class override reaches through cascade order** (T129a). The
 *     instance writes `.b2b-btn { border-radius: 2px }` in the same slot, and
 *     both rules are in the compiled stylesheet with the client's last. Order
 *     and not membership: a set-shaped assertion passes over a stylesheet in
 *     which the client's rule came first and never rendered;
 *  5. and in the control instance, which overrides nothing, both are the
 *     package's. Without (5), (3) and (4) are satisfied by any stylesheet that
 *     happens to carry those values, and the guard agrees with itself.
 *
 * (3), (4) and (5) are **T129a**, and they are what closes T121 — the brand and
 * theme seam *"declared rather than discovered"*: a client changes a value and a
 * class with no package file in their tree, asserted over a compiled stylesheet
 * rather than described in a contract.
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
 * `--primary`, as the design system declares it.
 *
 * It is an **indirection into the accent triplet** rather than a literal, and
 * that is what T129's reconciliation left standing: `design-tokens.css` declared
 * `--primary: var(--accent-h) var(--accent-s) var(--accent-l)` while the
 * package's own slate literal was the copy an instance overwrote on every load.
 *
 * It is asserted **unchanged** in both instances, and that is the whole of
 * T129a's token half: the overriding instance moves the palette by redeclaring
 * `--accent-h` and never names `--primary` at all. If the merge had flattened
 * the indirection — one perfectly reasonable way to reconcile two palettes —
 * this fixture would still emit `.bg-primary`, the control would still match,
 * and the seam would silently be gone.
 */
const PACKAGE_PRIMARY = 'var(--accent-h) var(--accent-s) var(--accent-l)';
/** The accent hue the design system declares, and what the client moves it to. */
const PACKAGE_ACCENT_HUE = '248';
const CLIENT_ACCENT_HUE = '262';
/** The class the overriding instance rewrites, and the value it gives it. */
const OVERRIDDEN_CLASS = 'b2b-btn';
const CLIENT_BUTTON_RADIUS = '2px';

/**
 * The instance's own stylesheet — R2.3's four lines, minus the generated
 * enumeration, which is `tailwind-module-package-sources.test.ts`' subject and
 * would only add sources this fixture makes no claim about.
 *
 * The override slot carries **both kinds** R4 names, because R2.3 says a client
 * holds exactly this and nothing else: a redeclaration for a value (R4.3) and a
 * later rule for a class (R4.4).
 */
function stylesheetOf(overrides: boolean): string {
  return [
    '@import "tailwindcss";',
    '@import "@endora-commerce/admin-kit/theme.css";',
    ...(overrides
      ? [
          '',
          ':root {',
          `  --accent-h: ${CLIENT_ACCENT_HUE};`,
          '}',
          '',
          `.${OVERRIDDEN_CLASS} {`,
          `  border-radius: ${CLIENT_BUTTON_RADIUS};`,
          '}',
        ]
      : []),
    '',
  ].join('\n');
}

/**
 * Every file a fixture instance holds — and **none of them is the package's**,
 * which is T126's claim stated as a list a reader can check.
 */
const INSTANCE_FILES = ['index.html', 'src/main.tsx', 'src/index.css'] as const;

function writeInstance(dir: string, overrides: boolean): void {
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
      '// Two classes: a utility that only the design system package\'s `@theme`\n' +
      '// can resolve, and a vocabulary class only its rules can define. An\n' +
      '// instance that got neither would build green and render unstyled, which\n' +
      '// is the whole failure this fixture is for.\n' +
      'export const Screen = () => (\n' +
      '  <div className="bg-primary">\n' +
      `    <button type="button" className="${OVERRIDDEN_CLASS}" />\n` +
      '  </div>\n' +
      ');\n',
    'utf8',
  );
  writeFileSync(path.join(dir, 'src/index.css'), stylesheetOf(overrides), 'utf8');
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
function declarationsUnder(
  css: string,
  selector: string,
  property: string,
): readonly string[] {
  const values: string[] = [];
  const declaration = new RegExp(`${property}:\\s*([^;]+);`, 'g');
  for (const block of css.matchAll(/(^|\n)\s*([^\n{}]+?)\s*\{([^{}]*)\}/g)) {
    if (block[2]!.trim() !== selector) continue;
    for (const found of block[3]!.matchAll(declaration)) values.push(found[1]!.trim());
  }
  return values;
}

/**
 * Every `border-radius` a rule for one selector declares, in **source order**.
 *
 * The class half's assertion is about order and nothing else: the design system
 * defines `.b2b-btn` and the instance defines it again, later, and CSS resolves
 * that by cascade position. A set-shaped assertion would pass over a compiled
 * stylesheet in which the client's rule came *first* and never rendered.
 */
function radiiOf(css: string, selector: string): readonly string[] {
  return declarationsUnder(css, `.${selector}`, 'border-radius');
}

const overriding = path.join(FIXTURE_ROOT, 'overriding');
const control = path.join(FIXTURE_ROOT, 'control');

describe('the design system belongs to a package and an instance overrides it by redeclaration', () => {
  beforeAll(() => {
    writeInstance(overriding, true);
    writeInstance(control, false);
  });

  afterAll(() => {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  });

  it('reaches the design system by name, with no package file in the instance tree', async () => {
    // The claim T126 made and T129 doubled: what the client holds is these
    // three files, and the design system is reached by name through the same
    // `node_modules` a client's instance has.
    expect(INSTANCE_FILES).toEqual(['index.html', 'src/main.tsx', 'src/index.css']);
    expect(stylesheetOf(true)).toContain('@import "@endora-commerce/admin-kit/theme.css";');
    expect(stylesheetOf(true)).not.toContain('@theme');
    expect(stylesheetOf(true)).not.toContain('@layer');

    const css = await compileInstance(overriding);
    expect(css.length).toBeGreaterThan(0);

    // (1) the `@theme inline` block arrived, and the token is an indirection —
    // which is the whole of why a redeclaration can reach a utility the package
    // compiled without ever seeing this instance (R3.2).
    expect(css).toMatch(/\.bg-primary\s*\{\s*background-color:\s*hsl\(var\(--primary\)\);/);

    // (2) the **class vocabulary** arrived with the tokens (T129, R4.4). It
    // replaces the assertion this file carried until T128, which named one of
    // the 23 shim classes and was therefore asserting the presence of dead
    // surface. `.b2b-btn` is one of the 137 that 70 files in `packages/` really
    // render, and nothing in the instance defines it.
    expect(radiiOf(css, OVERRIDDEN_CLASS).length).toBeGreaterThan(0);
  }, 180_000);

  it('lets the instance change a token and a class, and defaults to the package when it does not', async () => {
    // T129a, and it is what closes T121: the brand-and-theme seam asserted
    // rather than described. A client redeclares one value and writes one rule,
    // in the slot R2.3 gives them, and gets both — with no package file in
    // their tree.
    const [overridden, defaulted] = await Promise.all([
      compileInstance(overriding),
      compileInstance(control),
    ]);

    // (3) **the token, through the indirection.** The instance redeclares
    // `--accent-h` and never names `--primary`; the package's `--accent-h` is
    // still above it, which is what makes this an override rather than a
    // replacement, and the client's is last, which is what makes it win.
    expect(declarationsUnder(overridden, ':root', '--accent-h')).toEqual([
      PACKAGE_ACCENT_HUE,
      CLIENT_ACCENT_HUE,
    ]);
    // And `--primary` is untouched in both. A merge that had flattened the
    // indirection to a literal would still emit `.bg-primary` and would still
    // satisfy the control — and the one-line override would silently reach
    // nothing.
    expect(declarationsUnder(overridden, ':root', '--primary')).toEqual([PACKAGE_PRIMARY]);
    expect(declarationsUnder(defaulted, ':root', '--primary')).toEqual([PACKAGE_PRIMARY]);

    // (4) **the class, through cascade order.** Both rules are in the compiled
    // stylesheet and the client's is last, which is the whole mechanism R4.4
    // gives a client for a class: they do not edit the package, they write a
    // later rule. Order and not membership — a set-shaped assertion passes over
    // a stylesheet in which the client's rule came first and never rendered.
    const overriddenRadii = radiiOf(overridden, OVERRIDDEN_CLASS);
    expect(overriddenRadii.length).toBeGreaterThan(1);
    expect(overriddenRadii.at(-1)).toBe(CLIENT_BUTTON_RADIUS);

    // (5) the control, which overrides nothing, gets the package's defaults —
    // and never the client's. Without it, (3) and (4) are satisfied by any
    // stylesheet that happens to carry those values for some other reason.
    expect(declarationsUnder(defaulted, ':root', '--accent-h')).toEqual([PACKAGE_ACCENT_HUE]);
    expect(radiiOf(defaulted, OVERRIDDEN_CLASS)).not.toContain(CLIENT_BUTTON_RADIUS);
    expect(radiiOf(defaulted, OVERRIDDEN_CLASS).length).toBe(1);

    // And the token override reaches `:root` alone. A client restyling the
    // light palette has not silently taken the package's dark one with it.
    expect(declarationsUnder(overridden, '.dark', '--primary')).toEqual(
      declarationsUnder(defaulted, '.dark', '--primary'),
    );
  }, 180_000);
});
