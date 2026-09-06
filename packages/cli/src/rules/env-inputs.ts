/**
 * CI check — **every environment value a running Endora reads is declared, and
 * every declared input is read** (`specs/117-instance-bring-up/` FR-003;
 * `contracts/environment-inputs.md` §3).
 *
 * ## Why a check of its own
 *
 * No existing check's population contains a `process.env` read.
 * `check:module-boundary` reads import specifiers and SQL tables,
 * `check:admin-zones` reads zone names and `useTranslation` scopes,
 * `i18n:hardcoded` reads JSX in `.tsx`, `check:default-language-prose` reads
 * prose literals, `check:entry-scope` reads entry sites. Widening one of them
 * would be issue #244's shape arriving through the repair: a rule's stated
 * subject enlarged past what its walk can see.
 *
 * ## Both directions, and the second one is the one that would rot
 *
 * `undeclared-input` is a variable a client's `.env` will be short of — loud,
 * eventually, as a failed boot nobody can attribute. `unread-input` is an
 * operator being asked for a value that changes nothing, and **nothing else in
 * the tree would ever notice it**: the read went away, the declaration stayed,
 * and the prompt goes on asking. A one-way check would leave the declaration
 * accumulating variables the platform stopped reading three features ago,
 * which is how a contract stops being believed.
 *
 * ## The population is roots, never "the trees that happen to declare"
 *
 * §R3.4. Inferring the population from the presence of declarations is issue
 * #244's shape exactly: a tree that declares nothing and reads five variables
 * would be perfectly clean. So the roots are handed in by the host, one per
 * member of `ENVIRONMENT_CONSUMERS` — the contract package's own enum, which is
 * authored nowhere near this check and does not move when a declaration does —
 * and a consumer that contributed no file is a refusal rather than a consumer
 * with nothing wrong in it.
 *
 * ## Two read dialects, because the tree has two
 *
 * `process.env.X` and `process.env['X']` for anything Node runs, and
 * `import.meta.env.X` / `import.meta.env['X']` for the admin, which is a Vite
 * SPA and reads **no** `process.env` at all — measured: 0 sites over 294 files.
 * A check that knew only the Node dialect would report the admin's single input
 * as `unread-input` and its actual read as nothing at all, which is a finding
 * about the check dressed as one about the tree.
 *
 * **In the Vite dialect only a prefixed name comes from the environment.**
 * `import.meta.env.DEV`, `PROD`, `MODE`, `SSR` and `BASE_URL` are Vite's own
 * constants, substituted from the build mode: no `.env` can supply one and no
 * operator can be asked for one, so they are not inputs and are not read as
 * such. The discriminator is the {@link VITE_ENVIRONMENT_PREFIX} Vite itself
 * uses to decide the same question, not a list of the built-ins that exist
 * today. The Node dialect has no equivalent exclusion and needs none —
 * `NEXT_RUNTIME` is a real process variable that Next sets, so it is declared
 * like any other, with a sentence saying an operator has nothing to choose.
 *
 * ## A named constant is not a computed name
 *
 * `unresolvable-input-name` is a finding and never a skip (issue #113): read as
 * "declared" it agrees with everything. But the tree's own **correct** idiom
 * writes `process.env[PUBLIC_API_BASE_URL_VAR]`, where the constant is a string
 * literal exported by `storefront/lib/env.mjs` — one spelling of the variable
 * in one place, which is the shape this repository wants and which a naive
 * "computed ⇒ unresolvable" rule would punish on the day it landed. Two of the
 * storefront's own reads are written that way. So an identifier is resolved
 * two hops: a `const` in the same file whose initialiser is a string literal,
 * and an imported binding whose source file — within the walk — exports one.
 * Anything further is `unresolvable-input-name`, which is the fail-closed
 * direction.
 *
 * ## What `foreign-input` covers, and why it is two shapes under one kind
 *
 * A declaration is shipped by an **author** — the platform, one application,
 * or one module — and both shapes are that author declaring something that is
 * not theirs, with one remedy: delete it and let the owner declare it.
 *
 *   * `owner` disagreeing with the author that ships the file. The storefront
 *     declaring `{ kind: 'platform' }` puts a fact about the platform in a tree
 *     a client owns and edits.
 *   * one name declared twice **within one author's** declaration. Two entries,
 *     two `describes`, and whichever the reader reaches first wins.
 *
 * **Across authors a shared name is expected and is not a finding**, and that
 * distinction is load-bearing. `REVALIDATE_SECRET` is declared by the platform
 * *and* by the storefront, because under D-195 those are two repositories that
 * ship independently and each has to be able to say what it needs. That the two
 * declarations name each other in `consumers` is precisely what §5's cross-tree
 * agreement is derived from; collapsing them into one declaration would leave a
 * scaffolded storefront unable to state its own requirements.
 *
 * ## What it does not judge, stated rather than discovered later
 *
 *   * **Whether a value is correct.** That is `endora doctor`'s question and it
 *     needs a running environment.
 *   * **A module's inputs.** They are declared in `manifest.ts` and land with
 *     this feature's Phase 3; until then the module tree is outside this
 *     population and the host **prints** that rather than passing over it in
 *     silence.
 *   * **A read reached through a helper in another file** —
 *     `readEnv('DATABASE_URL')`. The walk sees member expressions on
 *     `process.env` and `import.meta.env`, not every function that might
 *     forward one.
 *   * **A `.env.example`.** It is prose, it is stale, and reconciling against
 *     it would make a stale file authoritative.
 */
import ts from 'typescript';

import {
  ENVIRONMENT_CONSUMERS,
  type EnvironmentConsumer,
  type EnvironmentInput,
  type EnvironmentInputOwner,
} from '@endora-commerce/contracts';

/** The log prefix both hosts print under — one grammar, one spelling. */
export const PREFIX = '[env-inputs]';

export type EnvInputFindingKind =
  | 'undeclared-input'
  | 'unread-input'
  | 'foreign-input'
  | 'unresolvable-input-name'
  | 'generable-without-secret'
  | 'requirement-without-a-consequence';

/** What to do about each kind, printed above the findings of that kind. */
export const REMEDIES: Readonly<Record<EnvInputFindingKind, string>> = {
  'undeclared-input':
    'This code reads an environment variable nothing declares, so no `.env` written by ' +
    '`endora new instance` or `endora new storefront` will carry it and `endora doctor` ' +
    'cannot tell an operator it is missing. Declare it where the code that reads it lives: ' +
    'the platform in `packages/platform/src/env/index.ts`, an application in its own ' +
    '`environment-inputs.mjs`, a module in its `manifest.ts`.',
  'unread-input':
    'This input is declared and nothing reads it, so an operator is asked for a value that ' +
    'changes nothing. Delete the declaration, or restore the read it was written for.',
  'foreign-input':
    'This declaration is not the shipping author’s to make — either its `owner` names ' +
    'somebody else, or the same author declares the name twice. Delete it and let the owner ' +
    'declare it. A name declared by two *different* authors is not this finding: two trees ' +
    'that ship independently each state what they need, and `consumers` is what joins them.',
  'unresolvable-input-name':
    'The variable is named by an expression this analysis cannot resolve to a literal, so it ' +
    'can be reconciled against no declaration. Write the name as a string literal, or as a ' +
    '`const` initialised to one — either in this file or exported by a file in the same ' +
    'tree, which is the idiom `storefront/lib/env.mjs` already uses.',
  'generable-without-secret':
    '`generable` is permitted only on a secret whose two correct values are interchangeable ' +
    '(`input-resolution.md` R4.5). A URL, a name, a channel code, a locale or a hostname ' +
    'carries a human judgement and may never be generated: the tool would be inventing the ' +
    'value the provenance line promises it does not.',
  'requirement-without-a-consequence':
    'An `optional` input has to say **what is lost** without it, in both shipped languages — ' +
    'that sentence is what an operator decides on, and the word “optional” is not it. A ' +
    '`requiredWhen` has to name an input some declaration carries, or the condition can ' +
    'never be evaluated and the input is required by nobody.',
};

/** One `process.env` / `import.meta.env` member access the walk saw. */
export interface EnvironmentRead {
  /** The variable, or `null` where the name could not be resolved to a literal. */
  readonly name: string | null;
  /** Repository-relative, POSIX separators. */
  readonly file: string;
  readonly line: number;
  /** Which tree the file belongs to. */
  readonly consumer: EnvironmentConsumer;
  /** How the name was written, for the message. */
  readonly shape: 'literal' | 'const' | 'imported-const' | 'computed';
}

/** One author's declaration, as the host loaded it. */
export interface DeclarationSource {
  /** The author shipping it — what `owner` is reconciled against. */
  readonly author: EnvironmentInputOwner;
  /** Repository-relative path, for the message. */
  readonly file: string;
  readonly inputs: readonly EnvironmentInput[];
}

export interface EnvInputFinding {
  readonly kind: EnvInputFindingKind;
  /** The variable, or the declaration that has no name to give. */
  readonly name: string;
  /** Where it was found — a source file for a read, a declaration otherwise. */
  readonly where: string;
  readonly detail: string;
}

export interface EnvInputsInput {
  readonly declarations: readonly DeclarationSource[];
  readonly reads: readonly EnvironmentRead[];
}

export interface EnvInputsResult {
  readonly findings: readonly EnvInputFinding[];
  /** Every declared input, across authors. */
  readonly declared: number;
  /** Consumers that contributed both a declaration and at least one read site. */
  readonly consumersCovered: readonly EnvironmentConsumer[];
}

const authorKey = (owner: EnvironmentInputOwner): string =>
  owner.kind === 'platform'
    ? 'platform'
    : owner.kind === 'application'
      ? `application:${owner.application}`
      : `module:${owner.moduleId}`;

/**
 * The `(name, consumer)` key both reconciliations are asked against.
 *
 * One function rather than two template literals, because the two have to agree
 * exactly and the separator is invisible. `\0` is the separator for the usual
 * reason — it is the one byte neither a variable name nor a consumer can carry —
 * and it is spelled as an **escape**: a raw NUL in the source would make git
 * classify this file as binary and render every diff of it as
 * `Binary files differ`, which is `check:nul-bytes`' whole subject. The compiled
 * string is identical, so nothing about the key changes.
 */
const consumerKey = (name: string, consumer: EnvironmentConsumer): string =>
  `${name}\0${consumer}`;

/**
 * A sentence, rather than a string.
 *
 * `''` is refused by the schema; this is the next failure along — a `without`
 * reading `optional`, `n/a` or `-`, which parses and says nothing. Held to a
 * length rather than to a blocklist, in the idiom the host-internal subpath
 * reasons are held to.
 */
const SAYS_SOMETHING = 12;

/** The whole rule, pure over the record, so a proof enters where a run does. */
export function checkEnvironmentInputs(input: EnvInputsInput): EnvInputsResult {
  const findings: EnvInputFinding[] = [];

  // Every declared name, whoever declared it — the vocabulary a `requiredWhen`
  // predicate and an `undeclared-input` verdict are both answered against.
  const declaredNames = new Set<string>();
  // (name, consumer) → the declarations that claim it, for the read reconciliation.
  const byNameAndConsumer = new Map<string, DeclarationSource[]>();
  let declared = 0;

  for (const source of input.declarations) {
    const seen = new Set<string>();
    for (const entry of source.inputs) {
      declared += 1;
      declaredNames.add(entry.name);

      // — `foreign-input`, shape one: the owner is not the shipping author.
      if (authorKey(entry.owner) !== authorKey(source.author)) {
        findings.push({
          kind: 'foreign-input',
          name: entry.name,
          where: source.file,
          detail:
            `declared with owner \`${authorKey(entry.owner)}\` by ` +
            `\`${authorKey(source.author)}\`, which is not the author of this file`,
        });
      }

      // — `foreign-input`, shape two: declared twice by one author.
      if (seen.has(entry.name)) {
        findings.push({
          kind: 'foreign-input',
          name: entry.name,
          where: source.file,
          detail:
            'declared twice in one declaration — two entries, two `describes`, and whichever ' +
            'a reader reaches first wins',
        });
      }
      seen.add(entry.name);

      // — `generable-without-secret`.
      if (entry.generable && !entry.secret) {
        findings.push({
          kind: 'generable-without-secret',
          name: entry.name,
          where: source.file,
          detail: '`generable` is set on an input that is not a secret',
        });
      }

      // — `requirement-without-a-consequence`, the `optional` half.
      if (
        entry.requirement.kind === 'optional' &&
        (entry.requirement.without.en.trim().length < SAYS_SOMETHING ||
          entry.requirement.without.pl.trim().length < SAYS_SOMETHING)
      ) {
        findings.push({
          kind: 'requirement-without-a-consequence',
          name: entry.name,
          where: source.file,
          detail: 'its `optional` sentence does not say what is lost without the input',
        });
      }

      for (const consumer of entry.consumers) {
        const key = consumerKey(entry.name, consumer);
        const claims = byNameAndConsumer.get(key);
        if (claims === undefined) byNameAndConsumer.set(key, [source]);
        else claims.push(source);
      }
    }
  }

  // — `requirement-without-a-consequence`, the `requiredWhen` half. Second
  //   pass, because the vocabulary a predicate is answered against is every
  //   author's and not the declaring author's alone: a condition may
  //   legitimately read an input the platform owns.
  for (const source of input.declarations) {
    for (const entry of source.inputs) {
      if (entry.requirement.kind !== 'requiredWhen') continue;
      if (declaredNames.has(entry.requirement.input)) continue;
      findings.push({
        kind: 'requirement-without-a-consequence',
        name: entry.name,
        where: source.file,
        detail:
          `its condition reads \`${entry.requirement.input}\`, which no declaration carries, ` +
          'so the condition can never be true and the input is required by nobody',
      });
    }
  }

  // — `unresolvable-input-name` and `undeclared-input`, over the reads.
  const readNamesByConsumer = new Map<EnvironmentConsumer, Set<string>>();
  for (const read of input.reads) {
    if (read.name === null) {
      findings.push({
        kind: 'unresolvable-input-name',
        name: '(computed)',
        where: `${read.file}:${read.line}`,
        detail:
          'the variable is named by an expression that is neither a string literal nor a ' +
          'constant initialised to one',
      });
      continue;
    }
    const names = readNamesByConsumer.get(read.consumer) ?? new Set<string>();
    names.add(read.name);
    readNamesByConsumer.set(read.consumer, names);

    if (!byNameAndConsumer.has(consumerKey(read.name, read.consumer))) {
      findings.push({
        kind: 'undeclared-input',
        name: read.name,
        where: `${read.file}:${read.line}`,
        detail: `read in the ${read.consumer} tree, which declares no input of that name`,
      });
    }
  }

  // — `unread-input`. Asked per (name, consumer): an input declared as read by
  //   the storefront and read only by the backend is a declaration that is
  //   wrong about which tree needs it, which is exactly the fact `consumers`
  //   exists to carry and the fact member scoping runs on.
  for (const source of input.declarations) {
    for (const entry of source.inputs) {
      const unread = entry.consumers.filter(
        (consumer) => !(readNamesByConsumer.get(consumer)?.has(entry.name) ?? false),
      );
      if (unread.length === 0) continue;
      findings.push({
        kind: 'unread-input',
        name: entry.name,
        where: source.file,
        detail:
          `declared as read by ${unread.join(', ')}, and no source in ` +
          `${unread.length === 1 ? 'that tree' : 'those trees'} reads it`,
      });
    }
  }

  const declaringConsumers = new Set<EnvironmentConsumer>();
  for (const source of input.declarations) {
    for (const entry of source.inputs) {
      for (const consumer of entry.consumers) declaringConsumers.add(consumer);
    }
  }
  const consumersCovered = ENVIRONMENT_CONSUMERS.filter(
    (consumer) => declaringConsumers.has(consumer) && readNamesByConsumer.has(consumer),
  );

  return { findings, declared, consumersCovered };
}

/** A file the walk opened, with the tree it belongs to. */
export interface EnvSourceFile {
  /** Repository-relative, POSIX separators. */
  readonly path: string;
  readonly text: string;
  readonly consumer: EnvironmentConsumer;
}

const isProcessEnv = (node: ts.Expression): boolean =>
  ts.isPropertyAccessExpression(node) &&
  node.name.text === 'env' &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'process';

/**
 * The prefix Vite requires on a variable it takes from the environment.
 *
 * Vite's own `envPrefix`, at its default. A name without it is one of Vite's
 * build-mode constants and is not an operator input — see the header.
 */
export const VITE_ENVIRONMENT_PREFIX = 'VITE_';

const isImportMetaEnv = (node: ts.Expression): boolean =>
  ts.isPropertyAccessExpression(node) &&
  node.name.text === 'env' &&
  ts.isMetaProperty(node.expression);

const scriptKindOf = (path: string): ts.ScriptKind =>
  path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

/**
 * Every string constant a file exports or declares at module scope.
 *
 * Only a bare `const X = '…'`, deliberately. A `let`, a computed initialiser
 * and a member of an object literal are all outside it: each is a value that
 * can differ from what the reader sees, and the whole point of resolving a
 * constant here is that its value is decidable from the text.
 */
export function stringConstants(source: ts.SourceFile): ReadonlyMap<string, string> {
  const constants = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const initialiser = declaration.initializer;
      if (initialiser === undefined) continue;
      // `as const` and a plain literal both land here; a template literal with
      // no substitution is the same value written differently.
      const unwrapped = ts.isAsExpression(initialiser) ? initialiser.expression : initialiser;
      if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
        constants.set(declaration.name.text, unwrapped.text);
      }
    }
  }
  return constants;
}

/**
 * Where an imported identifier came from, as `(local name) → (specifier, exported name)`.
 *
 * Both spellings the tree writes — `import { X }` and `import { X as Y }`.
 * A namespace import is deliberately absent: `env.PUBLIC_API_BASE_URL_VAR` is a
 * property access, not an identifier, and resolving it would need the module
 * graph rather than one file's text.
 */
function importedBindings(
  source: ts.SourceFile,
): ReadonlyMap<string, { specifier: string; exported: string }> {
  const bindings = new Map<string, { specifier: string; exported: string }>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (clause?.namedBindings === undefined) continue;
    if (!ts.isNamedImports(clause.namedBindings)) continue;
    for (const element of clause.namedBindings.elements) {
      bindings.set(element.name.text, {
        specifier: statement.moduleSpecifier.text,
        exported: (element.propertyName ?? element.name).text,
      });
    }
  }
  return bindings;
}

/**
 * Resolve a relative import specifier against the importing file's directory,
 * in the walk's own key space.
 *
 * POSIX-only and extension-tolerant: the tree writes `./env.mjs` from a `.ts`
 * file (ESM's own rule) and `./env.js` where the target is `env.ts`. A bare
 * specifier resolves to nothing here, which is right — a constant published by
 * a package is not text this walk read.
 */
export function resolveRelative(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const fromDirectory = fromFile.slice(0, Math.max(0, fromFile.lastIndexOf('/')));
  const parts = `${fromDirectory}/${specifier}`.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.' || part.length === 0) continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

/** The extensions a resolved specifier may really be, in the order tried. */
const CANDIDATE_EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.mjs', '.js'];

/**
 * Every environment read in the walk, with its name resolved where it can be.
 *
 * The file text is the entry point (issue #130), so a red proof drives exactly
 * what a real run drives.
 */
export function collectEnvironmentReads(
  files: readonly EnvSourceFile[],
): readonly EnvironmentRead[] {
  const parsed = new Map<string, ts.SourceFile>();
  for (const file of files) {
    parsed.set(
      file.path,
      ts.createSourceFile(
        file.path,
        file.text,
        ts.ScriptTarget.Latest,
        true,
        scriptKindOf(file.path),
      ),
    );
  }
  const constantsByFile = new Map<string, ReadonlyMap<string, string>>();
  const constantsOf = (path: string): ReadonlyMap<string, string> => {
    const cached = constantsByFile.get(path);
    if (cached !== undefined) return cached;
    const source = parsed.get(path);
    const computed = source === undefined ? new Map<string, string>() : stringConstants(source);
    constantsByFile.set(path, computed);
    return computed;
  };

  /** The second hop: an imported constant, resolved in the walk's own files. */
  const importedConstant = (file: EnvSourceFile, identifier: string): string | undefined => {
    const source = parsed.get(file.path);
    if (source === undefined) return undefined;
    const binding = importedBindings(source).get(identifier);
    if (binding === undefined) return undefined;
    const base = resolveRelative(file.path, binding.specifier);
    if (base === null) return undefined;
    // ESM specifiers name the emitted file; the walk holds the source. Try the
    // specifier as written first, then the source extensions it could be.
    const stem = base.replace(/\.(js|mjs|cjs)$/, '');
    for (const extension of CANDIDATE_EXTENSIONS) {
      const candidate = `${stem}${extension}`;
      if (!parsed.has(candidate)) continue;
      const value = constantsOf(candidate).get(binding.exported);
      if (value !== undefined) return value;
    }
    return undefined;
  };

  const reads: EnvironmentRead[] = [];
  for (const file of files) {
    if (!file.text.includes('process.env') && !file.text.includes('import.meta.env')) continue;
    const source = parsed.get(file.path);
    if (source === undefined) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const container = node.expression;
        const viteDialect = isImportMetaEnv(container);
        if (isProcessEnv(container) || viteDialect) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          // Vite's build-mode constants are not environment inputs: no `.env`
          // supplies one and no operator can be asked for one. The prefix is
          // Vite's own discriminator for the same question.
          const fromEnvironment = (name: string): boolean =>
            !viteDialect || name.startsWith(VITE_ENVIRONMENT_PREFIX);
          if (ts.isPropertyAccessExpression(node)) {
            if (fromEnvironment(node.name.text)) {
              reads.push({
                name: node.name.text,
                file: file.path,
                line,
                consumer: file.consumer,
                shape: 'literal',
              });
            }
          } else {
            const argument = node.argumentExpression;
            if (ts.isStringLiteralLike(argument)) {
              if (fromEnvironment(argument.text)) {
                reads.push({
                  name: argument.text,
                  file: file.path,
                  line,
                  consumer: file.consumer,
                  shape: 'literal',
                });
              }
            } else if (ts.isIdentifier(argument)) {
              const local = constantsOf(file.path).get(argument.text);
              const resolved = local ?? importedConstant(file, argument.text);
              if (resolved === undefined || fromEnvironment(resolved)) {
                reads.push({
                  name: resolved ?? null,
                  file: file.path,
                  line,
                  consumer: file.consumer,
                  shape:
                    local !== undefined
                      ? 'const'
                      : resolved !== undefined
                        ? 'imported-const'
                        : 'computed',
                });
              }
            } else {
              reads.push({
                name: null,
                file: file.path,
                line,
                consumer: file.consumer,
                shape: 'computed',
              });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return reads;
}

/** Raised when a declaration file cannot be read as one; a caller turns it into exit 2. */
export class DeclarationUnreadableError extends Error {
  override readonly name = 'DeclarationUnreadableError';
}

/**
 * A declaration read out of its own **source text**, never out of a build.
 *
 * ## Why not `import()` the emitted module
 *
 * A module package resolves through its `exports` map at its build output
 * (D-164), so a check that imported one would answer about the previous build —
 * the `stale-artefact` class `check:action-route-permissions` had to grow a
 * refusal for, measured three times as a **false green** on that check. Reading
 * the text removes the question rather than guarding it: the bytes this run
 * judged are the bytes on disk, and the check needs no build to run at all.
 * The `exports` subpath is still the path the *runtime* readers take, and
 * `test/unit/packages/platform-env-subpath.test.ts` is what holds it open.
 *
 * ## What it evaluates, and what it refuses
 *
 * A declaration is data: an array of object literals over strings, booleans,
 * arrays and nested objects. Nothing else is accepted — no identifier, no
 * spread, no call, no concatenation — and an expression outside that grammar is
 * a refusal rather than a value guessed at, because a declaration this analysis
 * cannot read in full is one it must not report on (issue #113).
 *
 * A string is taken literally, so `'\n'` and a template literal with no
 * substitution both arrive as the text they denote. `as const` is unwrapped:
 * it changes a type and no value.
 */
export function evaluateDeclarationArray(
  text: string,
  fileName: string,
  exportName: string,
): readonly unknown[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(fileName),
  );

  const literal = (node: ts.Node): unknown => {
    const unwrapped =
      ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)
        ? node.expression
        : node;
    if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
      return unwrapped.text;
    }
    if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (unwrapped.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isNumericLiteral(unwrapped)) return Number(unwrapped.text);
    if (ts.isArrayLiteralExpression(unwrapped)) return unwrapped.elements.map(literal);
    if (ts.isObjectLiteralExpression(unwrapped)) {
      const value: Record<string, unknown> = {};
      for (const property of unwrapped.properties) {
        if (!ts.isPropertyAssignment(property)) {
          throw new DeclarationUnreadableError(
            `${fileName}: a property that is not a plain \`key: value\` assignment — a ` +
              'declaration is data and this analysis will not guess at it',
          );
        }
        const key = ts.isIdentifier(property.name)
          ? property.name.text
          : ts.isStringLiteral(property.name)
            ? property.name.text
            : null;
        if (key === null) {
          throw new DeclarationUnreadableError(
            `${fileName}: a computed property name, which no declaration may carry`,
          );
        }
        value[key] = literal(property.initializer);
      }
      return value;
    }
    throw new DeclarationUnreadableError(
      `${fileName}: \`${unwrapped.getText(source).slice(0, 60)}\` is not a literal — a ` +
        'declaration may hold only strings, booleans, numbers, arrays and objects',
    );
  };

  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (declaration.name.text !== exportName) continue;
      if (declaration.initializer === undefined) {
        throw new DeclarationUnreadableError(`${fileName}: \`${exportName}\` has no value`);
      }
      const value = literal(declaration.initializer);
      if (!Array.isArray(value)) {
        throw new DeclarationUnreadableError(`${fileName}: \`${exportName}\` is not an array`);
      }
      return value;
    }
  }
  throw new DeclarationUnreadableError(
    `${fileName}: no \`${exportName}\` declaration — the file is not a declaration this ` +
      'run can read, and a run that could not read its input has said nothing about the tree',
  );
}
