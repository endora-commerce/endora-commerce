/**
 * Companion to `check:env-inputs` — every shape it claims to refuse, and the
 * two it claims **not** to, each entering where a real run enters (issue #130).
 *
 * The entry points are source **text** and declaration records, which is what a
 * real run reads: the host walks files, reads their bytes and evaluates the
 * declaration out of its own text. A fixture handing in a pre-classified read
 * would prove the reporter and leave the collector — where the whole of the
 * named-constant resolution lives — unproven.
 *
 * The negatives are the ones worth having twice over, because both are places a
 * plausible implementation goes wrong in the direction that reads clean:
 *
 *   * a `process.env[CONST]` where the constant is a string literal resolves,
 *     and does **not** become `unresolvable-input-name`. The tree's own correct
 *     idiom is written that way — `storefront/lib/env.mjs` exports the two
 *     variable names and `next.config.js` and `instrumentation.ts` read through
 *     them — and a check that punished it would have landed with two findings
 *     against the file that exists to remove the very defect this feature is
 *     about;
 *   * one name declared by **two different authors** is not `foreign-input`.
 *     `REVALIDATE_SECRET` is declared by the platform and by the storefront,
 *     because under D-195 those are two repositories that ship independently.
 */
import { describe, expect, it } from 'vitest';

import type { EnvironmentInput } from '@endora-commerce/contracts';

import { vacuousModulePopulation } from '../../../scripts/lib/module-population.js';

import {
  checkEnvironmentInputs,
  type ModuleVerdictShard,
  collectEnvironmentReads,
  DeclarationUnreadableError,
  evaluateDeclarationArray,
  evaluateManifestEnvDeclaration,
  type DeclarationSource,
  type EnvInputFindingKind,
  type EnvSourceFile,
} from '../../../scripts/check-env-inputs.js';

const input = (over: Partial<EnvironmentInput>): EnvironmentInput => ({
  name: 'DATABASE_URL',
  describes: { en: 'where the data is.', pl: 'gdzie są dane.' },
  requirement: { kind: 'required' },
  secret: true,
  generable: false,
  owner: { kind: 'platform' },
  consumers: ['backend'],
  addressOf: null,
  ...over,
});

const platformDeclaration = (inputs: readonly EnvironmentInput[]): DeclarationSource => ({
  author: { kind: 'platform' },
  file: 'packages/platform/src/env/index.ts',
  inputs,
});

const storefrontDeclaration = (inputs: readonly EnvironmentInput[]): DeclarationSource => ({
  author: { kind: 'application', application: 'storefront' },
  file: 'storefront/environment-inputs.mjs',
  inputs,
});

const backendSource = (text: string, path = 'backend/src/x.ts'): EnvSourceFile => ({
  path,
  text,
  consumer: 'backend',
});

const moduleDeclaration = (
  moduleId: string,
  inputs: readonly EnvironmentInput[],
): DeclarationSource => ({
  author: { kind: 'module', moduleId },
  file: `packages/modules/${moduleId}/src/manifest.ts`,
  inputs,
});

/** A module's own source file, as the host attributes one. */
const moduleSource = (moduleId: string, text: string): EnvSourceFile => ({
  path: `packages/modules/${moduleId}/src/backend/index.ts`,
  text,
  consumer: 'backend',
  module: moduleId,
});

const kindsOf = (
  declarations: readonly DeclarationSource[],
  files: readonly EnvSourceFile[],
): readonly EnvInputFindingKind[] =>
  checkEnvironmentInputs({
    declarations,
    reads: collectEnvironmentReads(files),
  }).findings.map((finding) => finding.kind);

describe('the eight findings', () => {
  it('reports a read of a name no declaration carries', () => {
    const kinds = kindsOf(
      [platformDeclaration([input({})])],
      [
        backendSource("const url = process.env['DATABASE_URL'];\n"),
        backendSource("const key = process.env['MEILISEARCH_URL'];\n", 'backend/src/y.ts'),
      ],
    );
    expect(kinds).toContain('undeclared-input');
    expect(kinds).not.toContain('unread-input');
  });

  it('reports a declared input no source in its consumers reads', () => {
    const kinds = kindsOf(
      [platformDeclaration([input({}), input({ name: 'REDIS_URL' })])],
      [backendSource("const url = process.env['DATABASE_URL'];\n")],
    );
    expect(kinds).toEqual(['unread-input']);
  });

  it('reports an input declared as read by a tree that does not read it', () => {
    // The half a name-level reconciliation would miss. The variable is read —
    // by the backend — and the declaration says the storefront reads it, which
    // is the fact member scoping runs on, so getting it wrong scopes the input
    // into a run that has no use for it.
    const kinds = kindsOf(
      [platformDeclaration([input({ consumers: ['backend', 'storefront'] })])],
      [backendSource("const url = process.env['DATABASE_URL'];\n")],
    );
    expect(kinds).toEqual(['unread-input']);
  });

  it('reports a declaration whose owner is not the author shipping it', () => {
    const kinds = kindsOf(
      [
        storefrontDeclaration([
          input({
            name: 'NEXT_PUBLIC_SITE_URL',
            owner: { kind: 'platform' },
            consumers: ['storefront'],
          }),
        ]),
      ],
      [
        {
          path: 'storefront/lib/a.ts',
          text: "export const u = process.env['NEXT_PUBLIC_SITE_URL'];\n",
          consumer: 'storefront',
        },
      ],
    );
    expect(kinds).toEqual(['foreign-input']);
  });

  it('reports one author declaring a name twice', () => {
    const kinds = kindsOf(
      [platformDeclaration([input({}), input({})])],
      [backendSource("const url = process.env['DATABASE_URL'];\n")],
    );
    expect(kinds).toEqual(['foreign-input']);
  });

  it('reports a computed name it cannot resolve to a literal', () => {
    const kinds = kindsOf(
      [platformDeclaration([input({})])],
      [
        backendSource(
          "const url = process.env['DATABASE_URL'];\n" +
            'export function read(name: string) { return process.env[name]; }\n',
        ),
      ],
    );
    expect(kinds).toEqual(['unresolvable-input-name']);
  });

  it('reports `generable` on an input that is not a secret', () => {
    const kinds = kindsOf(
      [platformDeclaration([input({ secret: false, generable: true })])],
      [backendSource("const url = process.env['DATABASE_URL'];\n")],
    );
    expect(kinds).toEqual(['generable-without-secret']);
  });

  it('reports an `optional` whose sentence does not say what is lost', () => {
    const kinds = kindsOf(
      [
        platformDeclaration([
          input({ requirement: { kind: 'optional', without: { en: 'optional', pl: '-' } } }),
        ]),
      ],
      [backendSource("const url = process.env['DATABASE_URL'];\n")],
    );
    expect(kinds).toEqual(['requirement-without-a-consequence']);
  });

  it('reports a `requiredWhen` reading an input no declaration carries', () => {
    const kinds = kindsOf(
      [
        platformDeclaration([
          input({
            requirement: {
              kind: 'requiredWhen',
              input: 'CATALOG_SEARCH_BACKEND',
              equals: 'meilisearch',
            },
          }),
        ]),
      ],
      [backendSource("const url = process.env['DATABASE_URL'];\n")],
    );
    expect(kinds).toEqual(['requirement-without-a-consequence']);
  });

  it('answers a `requiredWhen` against every author, not only its own', () => {
    // The predicate may legitimately read an input the platform owns from a
    // declaration the storefront ships. Asking it against the declaring
    // author's vocabulary alone would make that a finding.
    const kinds = kindsOf(
      [
        platformDeclaration([input({ name: 'CATALOG_SEARCH_BACKEND' })]),
        storefrontDeclaration([
          input({
            name: 'MEILISEARCH_URL',
            owner: { kind: 'application', application: 'storefront' },
            consumers: ['storefront'],
            requirement: {
              kind: 'requiredWhen',
              input: 'CATALOG_SEARCH_BACKEND',
              equals: 'meilisearch',
            },
          }),
        ]),
      ],
      [
        backendSource("const b = process.env['CATALOG_SEARCH_BACKEND'];\n"),
        {
          path: 'storefront/lib/a.ts',
          text: "export const u = process.env['MEILISEARCH_URL'];\n",
          consumer: 'storefront',
        },
      ],
    );
    expect(kinds).toEqual([]);
  });
});

describe('the two discriminations, each of which a plausible check gets wrong', () => {
  it('resolves a name written as a file-local constant', () => {
    const kinds = kindsOf(
      [platformDeclaration([input({})])],
      [
        backendSource(
          "const NAME = 'DATABASE_URL';\nexport const url = process.env[NAME];\n",
        ),
      ],
    );
    expect(kinds).toEqual([]);
  });

  it('resolves a name imported from another file in the same walk', () => {
    // `storefront/next.config.js`' own shape, letter for letter: the constant is
    // exported by a `.mjs` module and the importer names it with the extension
    // ESM requires.
    const files: EnvSourceFile[] = [
      {
        path: 'storefront/lib/env.mjs',
        text: "export const PUBLIC_API_BASE_URL_VAR = 'NEXT_PUBLIC_API_BASE_URL';\n",
        consumer: 'storefront',
      },
      {
        path: 'storefront/next.config.js',
        text:
          "import { PUBLIC_API_BASE_URL_VAR } from './lib/env.mjs';\n" +
          'export const value = process.env[PUBLIC_API_BASE_URL_VAR];\n',
        consumer: 'storefront',
      },
    ];
    const reads = collectEnvironmentReads(files);
    expect(reads.map((read) => [read.name, read.shape])).toContainEqual([
      'NEXT_PUBLIC_API_BASE_URL',
      'imported-const',
    ]);
    expect(
      checkEnvironmentInputs({
        declarations: [
          storefrontDeclaration([
            input({
              name: 'NEXT_PUBLIC_API_BASE_URL',
              owner: { kind: 'application', application: 'storefront' },
              consumers: ['storefront'],
            }),
          ]),
        ],
        reads,
      }).findings,
    ).toEqual([]);
  });

  it('does not report one name declared by two different authors', () => {
    const shared = {
      name: 'REVALIDATE_SECRET',
      consumers: ['backend', 'storefront'] as const,
    };
    const kinds = kindsOf(
      [
        platformDeclaration([input({ ...shared, consumers: [...shared.consumers] })]),
        storefrontDeclaration([
          input({
            ...shared,
            consumers: [...shared.consumers],
            owner: { kind: 'application', application: 'storefront' },
          }),
        ]),
      ],
      [
        backendSource("const s = process.env['REVALIDATE_SECRET'];\n"),
        {
          path: 'storefront/app/api/revalidate/route.ts',
          text: "export const s = process.env['REVALIDATE_SECRET'];\n",
          consumer: 'storefront',
        },
      ],
    );
    expect(kinds).toEqual([]);
  });

  it("reads Vite's build-mode constants as what they are: not environment inputs", () => {
    // `import.meta.env.DEV` is substituted from the build mode. No `.env`
    // supplies it and no operator can be asked for it, so a check that read it
    // as an input would report `undeclared-input` on three correct admin files
    // and send their author to write a declaration nobody can satisfy.
    const reads = collectEnvironmentReads([
      {
        path: 'admin/src/registerSw.ts',
        text:
          'if (import.meta.env.DEV) return;\n' +
          "const v = import.meta.env['VITE_BUILD_ID'];\n",
        consumer: 'admin',
      },
    ]);
    expect(reads.map((read) => read.name)).toEqual(['VITE_BUILD_ID']);
  });
});

describe('reading a declaration out of its own source text', () => {
  const DECLARATION = `
export const PLATFORM_ENVIRONMENT_INPUTS = [
  {
    name: 'DATABASE_URL',
    describes: { en: 'where the data is.', pl: 'gdzie są dane.' },
    requirement: { kind: 'required' },
    secret: true,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
  },
];
`;

  it('evaluates the array a declaration file exports', () => {
    const entries = evaluateDeclarationArray(
      DECLARATION,
      'packages/platform/src/env/index.ts',
      'PLATFORM_ENVIRONMENT_INPUTS',
    );
    expect(entries).toHaveLength(1);
    expect((entries[0] as { name: string }).name).toBe('DATABASE_URL');
  });

  it('refuses a value it cannot read, rather than guessing at one', () => {
    // Exit 2's own shape: a declaration holding an identifier, a call or a
    // spread is one this run cannot read **in full**, and a partial read would
    // reconcile against the entries that happened to parse while reporting on
    // all of them.
    expect(() =>
      evaluateDeclarationArray(
        "export const X = [{ name: DATABASE_URL_NAME }];\n",
        'x.ts',
        'X',
      ),
    ).toThrow(DeclarationUnreadableError);
    expect(() =>
      evaluateDeclarationArray('export const X = [{ ...base }];\n', 'x.ts', 'X'),
    ).toThrow(DeclarationUnreadableError);
  });

  it('refuses a file that declares nothing of that name', () => {
    expect(() => evaluateDeclarationArray('export const Y = [];\n', 'x.ts', 'X')).toThrow(
      DeclarationUnreadableError,
    );
  });
});

/**
 * The module half (`specs/117-instance-bring-up/` Phase 3, T3-B).
 *
 * The rule is not *"every module declares its reads"* — most of what a module
 * reads is not its own — but *"every read resolves against some declaration, and
 * the declaring authority is the owner"*. Three of the proofs below are the
 * three ways that sentence can be got wrong, and each is a state a plausible
 * implementation reaches while reporting clean.
 */
describe('a module declares what it owns, and reads what others own', () => {
  const OWN: EnvironmentInput = input({
    name: 'SEARCH_API_KEY',
    describes: {
      en: 'the key this module presents to the search engine.',
      pl: 'klucz, którym ten moduł uwierzytelnia się w wyszukiwarce.',
    },
    owner: { kind: 'module', moduleId: 'search' },
  });

  it('accepts a module reading an input it declares itself', () => {
    expect(
      kindsOf(
        [moduleDeclaration('search', [OWN])],
        [moduleSource('search', "const k = process.env['SEARCH_API_KEY'];\n")],
      ),
    ).toEqual([]);
  });

  it('accepts a module reading a platform-owned input and declaring nothing', () => {
    // The case that decides the whole shape: 7 of the 28 variables the module
    // tree reads are the platform's, read by thirty modules between them. A
    // check that demanded each module declare its reads would put one fact in
    // thirty manifests with thirty descriptions, which is D-100 thirty times.
    expect(
      kindsOf(
        [platformDeclaration([input({ name: 'STOREFRONT_BASE_URL', secret: false })])],
        [moduleSource('mfa', "const u = process.env['STOREFRONT_BASE_URL'];\n")],
      ),
    ).toEqual([]);
  });

  it('reports a module read no declaration carries as `undeclared-module-input`', () => {
    expect(
      kindsOf([], [moduleSource('pwa', "const s = process.env['PWA_VAPID_SUBJECT'];\n")]),
    ).toEqual(['undeclared-module-input']);
  });

  it('does not let a sibling module’s declaration satisfy this module’s read', () => {
    // `MEILISEARCH_URL` was the live case until D-229: `search` declared it,
    // and the `health_checks` module's liveness probe read it while declaring
    // no dependency on `search`. If one had covered the other, a client
    // installing that module alone would have been short a variable this check
    // had reported green — and would have met it as a probe saying the platform
    // was degraded. The probe is the platform's own now and that pair no longer
    // exists; the rule does, so the case keeps its shape over an arbitrary
    // second module.
    const findings = checkEnvironmentInputs({
      declarations: [
        moduleDeclaration('search', [
          input({
            name: 'MEILISEARCH_URL',
            secret: false,
            owner: { kind: 'module', moduleId: 'search' },
          }),
        ]),
      ],
      reads: collectEnvironmentReads([
        moduleSource('search', "const a = process.env['MEILISEARCH_URL'];\n"),
        moduleSource('analytics', "const b = process.env['MEILISEARCH_URL'];\n"),
      ]),
    }).findings;
    expect(findings.map((finding) => finding.kind)).toEqual(['undeclared-module-input']);
    expect(findings[0]?.where).toContain('analytics');
    // The message names the sibling, because that is the answer an author who
    // thinks this is already declared needs to read.
    expect(findings[0]?.detail).toContain('`search` declares it');
  });

  it('does not let a module’s declaration satisfy the application’s own read', () => {
    // The mirror, and it costs no second predicate: an application file carries
    // no module, so the `moduleId` comparison fails for every module author.
    expect(
      kindsOf(
        [moduleDeclaration('search', [OWN])],
        [backendSource("const k = process.env['SEARCH_API_KEY'];\n")],
      ).filter((kind) => kind === 'undeclared-input'),
    ).toEqual(['undeclared-input']);
  });

  it('reports a module declaring a name the platform owns', () => {
    const findings = checkEnvironmentInputs({
      declarations: [
        platformDeclaration([input({ name: 'STOREFRONT_BASE_URL', secret: false })]),
        moduleDeclaration('mfa', [
          input({
            name: 'STOREFRONT_BASE_URL',
            secret: false,
            owner: { kind: 'module', moduleId: 'mfa' },
          }),
        ]),
      ],
      reads: collectEnvironmentReads([
        backendSource("const u = process.env['STOREFRONT_BASE_URL'];\n"),
        moduleSource('mfa', "const v = process.env['STOREFRONT_BASE_URL'];\n"),
      ]),
    }).findings;
    expect(findings.map((finding) => finding.kind)).toEqual([
      'module-declares-a-platform-input',
    ]);
  });

  it('reports it whichever order the declarations arrive in', () => {
    // The question is asked against *another* author's declaration, so asking it
    // in the first pass would make the verdict depend on the order the host
    // handed the declarations in — green when the platform's came first, red
    // when it came second, over one tree.
    const platform = platformDeclaration([input({ name: 'NODE_ENV', secret: false })]);
    const module = moduleDeclaration('mfa', [
      input({ name: 'NODE_ENV', secret: false, owner: { kind: 'module', moduleId: 'mfa' } }),
    ]);
    const reads = collectEnvironmentReads([
      backendSource("const e = process.env['NODE_ENV'];\n"),
      moduleSource('mfa', "const f = process.env['NODE_ENV'];\n"),
    ]);
    for (const declarations of [
      [platform, module],
      [module, platform],
    ]) {
      expect(
        checkEnvironmentInputs({ declarations, reads }).findings.map((finding) => finding.kind),
      ).toEqual(['module-declares-a-platform-input']);
    }
  });

  it('does not report two modules declaring one name', () => {
    // The other direction of the sibling rule, and it is expected rather than
    // tolerated: a client may install either module alone, so each has to be
    // able to state what it needs. It is `REVALIDATE_SECRET`'s reasoning, one
    // surface over.
    const declaration = (moduleId: string): DeclarationSource =>
      moduleDeclaration(moduleId, [
        input({
          name: 'MEILISEARCH_URL',
          secret: false,
          owner: { kind: 'module', moduleId },
        }),
      ]);
    expect(
      kindsOf(
        [declaration('search'), declaration('analytics')],
        [
          moduleSource('search', "const a = process.env['MEILISEARCH_URL'];\n"),
          moduleSource('analytics', "const b = process.env['MEILISEARCH_URL'];\n"),
        ],
      ),
    ).toEqual([]);
  });

  it('asks `unread-input` over the declaring module’s own sources', () => {
    // A sibling reading the name does not earn this declaration. Over the whole
    // backend tree the question answers "read" for both the moment either one
    // reads it, and the direction this check exists to protect — an operator
    // asked for a value that changes nothing — would stop working for the module
    // half on the day it landed.
    const findings = checkEnvironmentInputs({
      declarations: [
        moduleDeclaration('search', [
          input({
            name: 'MEILISEARCH_URL',
            secret: false,
            owner: { kind: 'module', moduleId: 'search' },
          }),
        ]),
        moduleDeclaration('analytics', [
          input({
            name: 'MEILISEARCH_URL',
            secret: false,
            owner: { kind: 'module', moduleId: 'analytics' },
          }),
        ]),
      ],
      reads: collectEnvironmentReads([
        moduleSource('search', "const a = process.env['MEILISEARCH_URL'];\n"),
      ]),
    }).findings;
    expect(findings.map((finding) => finding.kind)).toEqual(['unread-input']);
    expect(findings[0]?.where).toContain('analytics');
  });
});

describe('reading a module’s `env` out of its manifest source text', () => {
  const MANIFEST = `
import { defineModuleManifest } from '@endora-commerce/contracts';

export const manifest = defineModuleManifest({
  id: 'search',
  name: 'Search',
  version: '1.0.0',
  dependencies: [],
  env: [
    {
      name: 'MEILISEARCH_API_KEY',
      describes: { en: 'the key.', pl: 'klucz.' },
      requirement: { kind: 'required' },
      secret: true,
      generable: false,
      owner: { kind: 'module', moduleId: 'search' },
      consumers: ['backend'],
      addressOf: null,
    },
  ],
});
`;

  it('evaluates the `env` array of the object handed to `defineModuleManifest`', () => {
    const entries = evaluateManifestEnvDeclaration(
      MANIFEST,
      'packages/modules/search/src/manifest.ts',
    );
    expect(entries).toHaveLength(1);
    expect((entries?.[0] as { name: string }).name).toBe('MEILISEARCH_API_KEY');
  });

  it('answers `null` for a manifest that declares no environment input', () => {
    // Most modules read none, and that is not a finding.
    expect(
      evaluateManifestEnvDeclaration(
        "import { defineModuleManifest } from 'x';\n" +
          "export const manifest = defineModuleManifest({ id: 'blog', name: 'B', version: '1.0.0', dependencies: [] });\n",
        'packages/modules/blog/src/manifest.ts',
      ),
    ).toBeNull();
  });

  it('ignores everything in the file that is not the `env` array', () => {
    // A manifest is **not** a literal file: `cms` reads
    // `process.env['CMS_PB_BREAKPOINT_TABLET_MIN']` in its own settings
    // defaults, so a reader that demanded one would refuse the very module whose
    // declaration this feature exists to collect.
    const entries = evaluateManifestEnvDeclaration(
      "import { defineModuleManifest } from 'x';\n" +
        'const fallback = Number(process.env[\'CMS_PB_BREAKPOINT_TABLET_MIN\'] ?? 768);\n' +
        "export const manifest = defineModuleManifest({\n" +
        "  id: 'cms', name: 'CMS', version: '1.0.0', dependencies: [],\n" +
        '  settings: { moduleCode: \'cms\', groups: [], settings: [{ defaultValue: fallback }] },\n' +
        '  env: [],\n' +
        '});\n',
      'packages/modules/cms/src/manifest.ts',
    );
    expect(entries).toEqual([]);
  });

  it('refuses a manifest with no `defineModuleManifest` call at all', () => {
    // Not "declares nothing" — a module whose manifest this run cannot find is
    // one it cannot report on, and reading the two as one answer is the silent
    // skip the estate is against (issue #113).
    expect(() => evaluateManifestEnvDeclaration('export const manifest = {};\n', 'x.ts')).toThrow(
      DeclarationUnreadableError,
    );
  });

  it('refuses an `env` entry it cannot read in full', () => {
    expect(() =>
      evaluateManifestEnvDeclaration(
        "export const manifest = defineModuleManifest({ id: 'x', env: [{ name: NAME }] });\n",
        'x.ts',
      ),
    ).toThrow(DeclarationUnreadableError);
    expect(() =>
      evaluateManifestEnvDeclaration(
        "export const manifest = defineModuleManifest({ id: 'x', env: [...shared] });\n",
        'x.ts',
      ),
    ).toThrow(DeclarationUnreadableError);
  });
});

describe('the module-population floor, which this check delegates rather than owns', () => {
  // `check-env-inputs.ts` is **not** in `moved-module-tree.test.ts`, so the
  // refusal is proven here instead, over the same shared helper the check calls.
  //
  // Why it is not there, measured on 2026-09-12: that fixture is a backend tree
  // plus packages, with no `storefront` member and no admin shell, so this check
  // reaches its own first and ninth refusals before the module floor is
  // consulted — exit 2 / 2 / 2 over the moved, split and half-moved trees, the
  // split one being the tree that is supposed to answer 0. Three identical exit
  // codes over three different trees assert no discrimination, which is worse
  // than no proof because it would read as a floor that works.
  // `check-inventory.test.ts`' `DEFERRED_SHARED_PROOFS` holds the measurement
  // and the condition that retires the entry.
  //
  // What it protects against is issue #215 in this check's own shape, and the
  // three application trees are what make it dangerous: they come back whole, so
  // `files=` stays healthy and every application read still resolves. A run that
  // opened no module source would report `findings=0` over a tree it never read
  // — and every module declaration it did load would read as `unread-input`, so
  // the report would not merely be silent, it would be confidently wrong in the
  // opposite direction and send its author to delete correct declarations.
  it('refuses a walk that produced no source for a registered module', () => {
    expect(
      vacuousModulePopulation({
        registered: ['search', 'analytics'],
        files: ['/repo/packages/modules/search/src/backend/index.ts'],
        moduleIdOf: (file) => (file.includes('/search/') ? 'search' : null),
      }),
    ).not.toBeNull();
  });

  it('does not refuse a walk that produced one for every module', () => {
    // The discrimination: without this case the assertion above is satisfied by
    // a helper that refuses everything.
    expect(
      vacuousModulePopulation({
        registered: ['search', 'analytics'],
        files: [
          '/repo/packages/modules/search/src/backend/index.ts',
          '/repo/packages/modules/analytics/src/backend/index.ts',
        ],
        moduleIdOf: (file) => (file.includes('/search/') ? 'search' : 'analytics'),
      }),
    ).toBeNull();
  });
});

/**
 * The Settings-debt ledger (FR-004, `contracts/environment-inputs.md` §4).
 *
 * Its subject is not whether a variable is *correct* but whether anybody has
 * **judged** it: a module-owned environment input is debt against the Settings
 * module until somebody has written down why it is not one. §4.4 is explicit
 * that this feature migrates none of them — it makes the population visible and
 * drainable — so the ledger's job is to keep a judgement attached to every entry
 * and to go stale loudly when the variable goes.
 */
describe('the Settings-debt ledger, both ways', () => {
  const DECLARED = moduleDeclaration('pwa', [
    input({
      name: 'PWA_VAPID_SUBJECT',
      secret: false,
      owner: { kind: 'module', moduleId: 'pwa' },
    }),
  ]);
  const READ = [moduleSource('pwa', "const s = process.env['PWA_VAPID_SUBJECT'];\n")];
  const shard = (entries: ModuleVerdictShard['entries']): ModuleVerdictShard => ({
    moduleId: 'pwa',
    entries,
  });
  const kinds = (verdicts: readonly ModuleVerdictShard[]): readonly EnvInputFindingKind[] =>
    checkEnvironmentInputs({
      declarations: [DECLARED],
      reads: collectEnvironmentReads(READ),
      settingsVerdicts: verdicts,
    }).findings.map((finding) => finding.kind);

  const JUDGED = {
    PWA_VAPID_SUBJECT: {
      classification: 'configuration' as const,
      reason: 'a per-shop contact address, read long after the settings store is open.',
    },
  };

  it('accepts a module-owned input somebody has judged', () => {
    expect(kinds([shard(JUDGED)])).toEqual([]);
  });

  it('reports a module-owned input nobody has judged', () => {
    expect(kinds([])).toEqual(['module-input-without-a-settings-verdict']);
  });

  it('reports an entry whose reason says nothing as no verdict at all', () => {
    // §4.3: an entry reading "convenience" or "historical" is a finding waiting
    // to be repaired rather than an exemption — and one reading `-` is not even
    // that. Held to a length rather than to a blocklist, in the idiom the
    // `optional` sentence is already held to.
    expect(
      kinds([shard({ PWA_VAPID_SUBJECT: { classification: 'bootstrap', reason: 'historical' } })]),
    ).toEqual(['module-input-without-a-settings-verdict']);
  });

  it('reports an entry describing an input the module no longer declares', () => {
    expect(
      kinds([shard({ ...JUDGED, PWA_VAPID_GONE: { ...JUDGED.PWA_VAPID_SUBJECT } })]),
    ).toEqual(['stale-settings-verdict']);
  });

  it('does not ask the question at all when the caller is not reconciling the ledger', () => {
    // `undefined` and `[]` are two states, deliberately. `[]` is "the ledger was
    // read and holds nothing", under which every module-owned declaration is
    // unjudged; `undefined` is "this caller is not reconciling it", which is
    // what a red proof about some other finding wants. Collapsing them would
    // make a fixture that says nothing about the ledger report on it anyway.
    expect(
      checkEnvironmentInputs({
        declarations: [DECLARED],
        reads: collectEnvironmentReads(READ),
      }).findings,
    ).toEqual([]);
  });

  it('says nothing about a platform-owned or application-owned declaration', () => {
    // The ledger's subject is **module** debt against the Settings module. The
    // platform's own inputs have no Settings home to move to — the store is the
    // thing several of them exist to open — so asking the question of them would
    // be 21 findings with no repair.
    expect(
      checkEnvironmentInputs({
        declarations: [platformDeclaration([input({})])],
        reads: collectEnvironmentReads([backendSource("const u = process.env['DATABASE_URL'];\n")]),
        settingsVerdicts: [],
      }).findings,
    ).toEqual([]);
  });
});
