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

import {
  checkEnvironmentInputs,
  collectEnvironmentReads,
  DeclarationUnreadableError,
  evaluateDeclarationArray,
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

const kindsOf = (
  declarations: readonly DeclarationSource[],
  files: readonly EnvSourceFile[],
): readonly EnvInputFindingKind[] =>
  checkEnvironmentInputs({
    declarations,
    reads: collectEnvironmentReads(files),
  }).findings.map((finding) => finding.kind);

describe('the six findings', () => {
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
