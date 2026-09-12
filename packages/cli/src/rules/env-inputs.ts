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
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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
  | 'undeclared-module-input'
  | 'unread-input'
  | 'foreign-input'
  | 'module-declares-a-platform-input'
  | 'unresolvable-input-name'
  | 'generable-without-secret'
  | 'requirement-without-a-consequence'
  | 'module-input-without-a-settings-verdict'
  | 'stale-settings-verdict';

/** What to do about each kind, printed above the findings of that kind. */
export const REMEDIES: Readonly<Record<EnvInputFindingKind, string>> = {
  'undeclared-input':
    'This code reads an environment variable nothing declares, so no `.env` written by ' +
    '`endora new instance` or `endora new storefront` will carry it and `endora doctor` ' +
    'cannot tell an operator it is missing. Declare it where the code that reads it lives: ' +
    'the platform in `packages/platform/src/env/index.ts`, an application in its own ' +
    '`environment-inputs.mjs`, a module in its `manifest.ts`.',
  'undeclared-module-input':
    'A module reads an environment variable that neither the platform, nor the application ' +
    'tree it runs in, nor this module’s own `manifest.ts` declares — so no `.env` a ' +
    'client writes will carry it and `endora doctor` cannot tell them it is missing. That ' +
    'matters more for a module than for anything else here: a module package ships `dist`, ' +
    '`i18n` and `docs`, and `.env.example` is a file in the platform’s own repository. ' +
    'Declare it in the module’s `env` array, with `owner` naming this module. **Another ' +
    'module’s declaration does not satisfy this read**, deliberately: a client may install ' +
    'this module and not that one, and an input that arrives only with a sibling is an input ' +
    'that is missing exactly when the sibling is.',
  'unread-input':
    'This input is declared and nothing reads it, so an operator is asked for a value that ' +
    'changes nothing. Delete the declaration, or restore the read it was written for. For a ' +
    'module the question is asked over that module’s own sources: a sibling reading the ' +
    'name does not make this declaration earned.',
  'module-declares-a-platform-input':
    'The platform already declares this variable, in `packages/platform/src/env/index.ts`, ' +
    'and a module’s read of it is satisfied by that declaration. Delete the entry. Seven ' +
    'names — `NODE_ENV`, `BACKEND_ROLE`, `STOREFRONT_BASE_URL`, `PUBLIC_API_BASE_URL`, ' +
    '`BACKEND_PUBLIC_URL`, `REVALIDATE_SECRET`, `SETTINGS_SECRET_ENCRYPTION_KEY` — are read ' +
    'by thirty modules between them, and a module that declares what it *reads* rather than ' +
    'what it *owns* puts one fact in thirty manifests with thirty descriptions. Whichever a ' +
    'reader reaches first wins and the rest drift (D-100).',
  'foreign-input':
    'This declaration is not the shipping author’s to make — either its `owner` names ' +
    'somebody else, or the same author declares the name twice. Delete it and let the owner ' +
    'declare it. A name declared by two *different* authors is not this finding: two trees ' +
    'that ship independently each state what they need, and `consumers` is what joins them.',
  'module-input-without-a-settings-verdict':
    'A module-owned environment input is debt against the Settings module until somebody has ' +
    'said why it is not one (`contracts/environment-inputs.md` §4). Add an entry to the ' +
    'module’s shard under `backend/scripts/ledgers/module-environment-inputs/`, ' +
    'classified `bootstrap` or `configuration`, with the reason. The legitimate answer is ' +
    'that the value is needed **before the settings store can be read** — ' +
    '`SETTINGS_SECRET_ENCRYPTION_KEY` and `MFA_SECRET_ENCRYPTION_KEY` are the standing ' +
    'examples, being the keys the store’s own secrets are decrypted with. "Convenience" ' +
    'and "historical" are `configuration`, which is a finding waiting to be repaired rather ' +
    'than an exemption — and an entry whose reason says nothing is not a verdict, so it is ' +
    'reported here rather than counted as one.',
  'stale-settings-verdict':
    'A ledger entry describes an environment input this module no longer declares. The ' +
    'ledger is two-way: it drains as a module moves its configuration into Settings, and an ' +
    'entry left behind is a claim about a variable that is gone. Delete it — and delete the ' +
    'shard when its last entry goes, because an empty file is a done signal that says ' +
    'nothing.',
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
  /**
   * The module whose sources the file is, or `undefined` for an application's
   * own file.
   *
   * It is what makes the resolution rule — *the platform's declaration, the
   * application's, and the reading module's own, never another module's* —
   * expressible at all (`specs/117-instance-bring-up/` T3-B). Without it a read
   * is only ever a `(name, consumer)` pair, and one module's declaration
   * silently covers every other module's read of the same name: a client
   * installing the reader and not the declarer would then be short a variable
   * this check had reported green.
   */
  readonly module?: string | undefined;
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

/**
 * What a module's environment input is, once somebody has judged it
 * (`contracts/environment-inputs.md` §4.2).
 *
 * `bootstrap` is a value the platform needs **before the settings store can be
 * read**; `configuration` is a knob that belongs to the Settings module and is
 * wearing an environment variable. The second is not an exemption — it is debt
 * with an owner, and the ledger exists to make the population drainable rather
 * than to bless it (§4.3, §4.4).
 */
export interface ModuleEnvironmentVerdict {
  readonly classification: 'bootstrap' | 'configuration';
  /** Why it is not a Setting. One question, answered in a sentence. */
  readonly reason: string;
}

/** One module's shard of the Settings-debt ledger, as the host loaded it. */
export interface ModuleVerdictShard {
  readonly moduleId: string;
  /** Keyed by the variable's name. */
  readonly entries: Readonly<Record<string, ModuleEnvironmentVerdict>>;
}

export interface EnvInputsInput {
  readonly declarations: readonly DeclarationSource[];
  readonly reads: readonly EnvironmentRead[];
  /**
   * The Settings-debt ledger, or `undefined` where the caller is not asking.
   *
   * The two states are deliberately distinct. `[]` is *"the ledger was read and
   * holds nothing"*, under which every module-owned declaration lacks a verdict;
   * `undefined` is *"this caller is not reconciling the ledger"*, which is what
   * a red proof about some other finding wants. Collapsing them would make a
   * fixture that says nothing about the ledger report on it anyway.
   *
   * The host always passes it, and refuses a ledger directory that is not there
   * rather than passing `undefined` — a missing ledger must never be the quiet
   * path.
   */
  readonly settingsVerdicts?: readonly ModuleVerdictShard[] | undefined;
}

export interface EnvInputsResult {
  readonly findings: readonly EnvInputFinding[];
  /** Every declared input, across authors. */
  readonly declared: number;
  /** Consumers that contributed both a declaration and at least one read site. */
  readonly consumersCovered: readonly EnvironmentConsumer[];
  /** Inputs declared by a module author, of {@link EnvInputsResult.declared}. */
  readonly declaredByModules: number;
  /** Module ids that declare at least one input. */
  readonly modulesDeclaring: readonly string[];
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
 * The same key, narrowed to one module — what `unread-input` is asked against
 * for a module author.
 *
 * A module declaring an input its **own** sources do not read is the finding;
 * a sibling reading the name does not earn the declaration, and asking the
 * question over the whole backend tree would say it did. That is not
 * hypothetical here: `MEILISEARCH_URL` is legitimately declared by two modules,
 * so the tree-wide question answers "read" for both the moment either one reads
 * it, and the direction this check exists to protect — an operator asked for
 * a value that changes nothing — would stop working for the module half on
 * the day it landed.
 */
const moduleKey = (module: string, name: string, consumer: EnvironmentConsumer): string =>
  `${module}\0${name}\0${consumer}`;

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
  // Every name the **platform** declares — what `module-declares-a-platform-input`
  // is asked against, and deliberately not "every name a non-module author
  // declares". The applications' names are excluded on purpose: the backend
  // genuinely reading a name the storefront also declares is `REVALIDATE_SECRET`'s
  // shape, two trees that ship independently each stating what they need, and
  // widening the predicate to cover it would turn a correct declaration into a
  // finding.
  const platformNames = new Set<string>();
  const modulesDeclaring = new Set<string>();
  let declared = 0;
  let declaredByModules = 0;

  for (const source of input.declarations) {
    const seen = new Set<string>();
    for (const entry of source.inputs) {
      declared += 1;
      declaredNames.add(entry.name);
      if (source.author.kind === 'platform') platformNames.add(entry.name);
      if (source.author.kind === 'module') {
        declaredByModules += 1;
        modulesDeclaring.add(source.author.moduleId);
      }

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

  // — `module-declares-a-platform-input`. A **second pass**, for the same reason
  //   the `requiredWhen` one below is: the question is asked against another
  //   author's declaration, so asking it inside the first loop would make the
  //   verdict depend on the order the host happened to hand the declarations in
  //   — green when the platform's came first, red when it came second, over one
  //   tree.
  //
  //   Not a shape of `foreign-input`: there the `owner` field is wrong and the
  //   remedy is "let the owner declare it"; here the `owner` is honest — the
  //   author really did mean this module — and the remedy is "delete it, the
  //   platform already said this". `defineModuleManifest` cannot see it, having
  //   no sight of the platform's declaration, so this is the only layer that can.
  for (const source of input.declarations) {
    if (source.author.kind !== 'module') continue;
    for (const entry of source.inputs) {
      if (!platformNames.has(entry.name)) continue;
      findings.push({
        kind: 'module-declares-a-platform-input',
        name: entry.name,
        where: source.file,
        detail:
          `declared by the module \`${source.author.moduleId}\`, and the platform declares it ` +
          'too — one variable, two descriptions, and whichever a reader reaches first wins',
      });
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

  // — `unresolvable-input-name`, `undeclared-input` and
  //   `undeclared-module-input`, over the reads.
  const readNamesByConsumer = new Map<EnvironmentConsumer, Set<string>>();
  const readNamesByModule = new Set<string>();
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
    if (read.module !== undefined) {
      readNamesByModule.add(moduleKey(read.module, read.name, read.consumer));
    }

    // **The resolution rule, and it is one predicate for both populations**
    // (T3-B): a read resolves against the platform's declaration, the
    // application tree's, and — where the file is a module's — that module's
    // own. Never another module's.
    //
    // A module's declaration must not cover an *application's* read either, and
    // the same line says so: `read.module` is `undefined` there, so the
    // `moduleId` comparison fails for every module author. One rule, two
    // populations, no second predicate to keep in step.
    const claims = byNameAndConsumer.get(consumerKey(read.name, read.consumer)) ?? [];
    const satisfied = claims.some(
      (claim) => claim.author.kind !== 'module' || claim.author.moduleId === read.module,
    );
    if (satisfied) continue;

    if (read.module === undefined) {
      findings.push({
        kind: 'undeclared-input',
        name: read.name,
        where: `${read.file}:${read.line}`,
        detail: `read in the ${read.consumer} tree, which declares no input of that name`,
      });
      continue;
    }
    // A sibling declaring it is worth saying, because it is the shape an author
    // is most likely to think already correct — and the answer is that a client
    // may install this module and not that one.
    const bySibling = claims.filter((claim) => claim.author.kind === 'module');
    const siblings =
      bySibling.length === 0
        ? ''
        : ` — ${bySibling
            .map((claim) =>
              claim.author.kind === 'module' ? `\`${claim.author.moduleId}\`` : '',
            )
            .join(', ')} declares it, and a sibling's declaration does not travel with this module`;
    findings.push({
      kind: 'undeclared-module-input',
      name: read.name,
      where: `${read.file}:${read.line}`,
      detail:
        `read by the module \`${read.module}\` in the ${read.consumer} tree, and neither the ` +
        `platform, the ${read.consumer} application nor \`${read.module}\`'s own manifest ` +
        `declares it${siblings}`,
    });
  }

  // — `unread-input`. Asked per (name, consumer): an input declared as read by
  //   the storefront and read only by the backend is a declaration that is
  //   wrong about which tree needs it, which is exactly the fact `consumers`
  //   exists to carry and the fact member scoping runs on.
  for (const source of input.declarations) {
    const author = source.author;
    // For a module the question is asked over **that module's own** sources.
    // See {@link moduleKey}: `MEILISEARCH_URL` is legitimately declared by two
    // modules, so a tree-wide question answers "read" for both the moment
    // either reads it.
    const isRead = (name: string, consumer: EnvironmentConsumer): boolean =>
      author.kind === 'module'
        ? readNamesByModule.has(moduleKey(author.moduleId, name, consumer))
        : (readNamesByConsumer.get(consumer)?.has(name) ?? false);
    for (const entry of source.inputs) {
      const unread = entry.consumers.filter((consumer) => !isRead(entry.name, consumer));
      if (unread.length === 0) continue;
      findings.push({
        kind: 'unread-input',
        name: entry.name,
        where: source.file,
        detail:
          author.kind === 'module'
            ? `declared as read by ${unread.join(', ')}, and no source of the module ` +
              `\`${author.moduleId}\` reads it there`
            : `declared as read by ${unread.join(', ')}, and no source in ` +
              `${unread.length === 1 ? 'that tree' : 'those trees'} reads it`,
      });
    }
  }

  // — The Settings-debt ledger, both ways (`environment-inputs.md` §4).
  //
  //   `undefined` is a caller that is not asking; `[]` is a ledger that was read
  //   and holds nothing, under which every module-owned declaration is
  //   unjudged. The second is the state a deleted ledger directory would
  //   produce, which is why the host refuses that rather than reaching here.
  if (input.settingsVerdicts !== undefined) {
    const verdictsOf = new Map<string, Readonly<Record<string, ModuleEnvironmentVerdict>>>(
      input.settingsVerdicts.map((shard) => [shard.moduleId, shard.entries]),
    );
    const declaredByModule = new Map<string, Set<string>>();
    for (const source of input.declarations) {
      if (source.author.kind !== 'module') continue;
      const names = declaredByModule.get(source.author.moduleId) ?? new Set<string>();
      for (const entry of source.inputs) names.add(entry.name);
      declaredByModule.set(source.author.moduleId, names);

      for (const entry of source.inputs) {
        const verdict = verdictsOf.get(source.author.moduleId)?.[entry.name];
        // A reason that says nothing is not a verdict. Held to a length rather
        // than to a blocklist, in the idiom the `optional` sentence is held to
        // twenty lines up — "historical" and "convenience" are the sentences an
        // entry written to make this pass would carry, and §4.3 calls them debt
        // rather than exemptions.
        if (verdict !== undefined && verdict.reason.trim().length >= SAYS_SOMETHING) continue;
        findings.push({
          kind: 'module-input-without-a-settings-verdict',
          name: entry.name,
          where: source.file,
          detail:
            verdict === undefined
              ? `declared by the module \`${source.author.moduleId}\` and judged by nobody — ` +
                'no entry in its shard of the Settings-debt ledger'
              : `its ledger entry does not say why it is ${verdict.classification} rather ` +
                'than a Setting',
        });
      }
    }

    for (const shard of input.settingsVerdicts) {
      const declared = declaredByModule.get(shard.moduleId) ?? new Set<string>();
      for (const name of Object.keys(shard.entries)) {
        if (declared.has(name)) continue;
        findings.push({
          kind: 'stale-settings-verdict',
          name,
          where: `backend/scripts/ledgers/module-environment-inputs/${shard.moduleId}.ts`,
          detail: `the module \`${shard.moduleId}\` declares no environment input of that name`,
        });
      }
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

  return {
    findings,
    declared,
    consumersCovered,
    declaredByModules,
    modulesDeclaring: [...modulesDeclaring].sort(),
  };
}

/** A file the walk opened, with the tree it belongs to. */
export interface EnvSourceFile {
  /** Repository-relative, POSIX separators. */
  readonly path: string;
  readonly text: string;
  readonly consumer: EnvironmentConsumer;
  /** The module this file belongs to, where the host could attribute it. */
  readonly module?: string | undefined;
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
                module: file.module,
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
                  module: file.module,
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
                  module: file.module,
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
                module: file.module,
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
  const literal = literalReader(source, fileName);

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

/**
 * The literal evaluator, shared by the two declaration readers above and below.
 *
 * One function rather than two copies: a module's `env` entries and the
 * platform's are the same data in two files, and two evaluators that drifted
 * would accept a declaration in one place and refuse it in the other for
 * reasons neither author could see.
 */
function literalReader(source: ts.SourceFile, fileName: string): (node: ts.Node) => unknown {
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
  return literal;
}

/** The helper every module's manifest is defined through. */
const MANIFEST_FACTORY = 'defineModuleManifest';

/**
 * A module's `env` declaration, read out of its `manifest.ts` **source text**.
 *
 * ## Why text and not the built manifest
 *
 * The same reason {@link evaluateDeclarationArray} gives, with more force: a
 * module package resolves through its own `exports` map at its build output
 * (D-164), so a reader that imported one would answer about the previous build.
 * That is the `stale-artefact` class `check:action-route-permissions` had to
 * grow a refusal for after three measured false greens — an `env` entry edited
 * and not rebuilt would be judged as though it were not there, which for *this*
 * check is a false green in the direction that matters: a declaration the author
 * just wrote, reported as missing, or one they just deleted, reported as
 * present. Reading the text removes the question instead of guarding it, and the
 * run needs no build at all.
 *
 * ## What it reads, and what it refuses
 *
 * Only the `env` property of the object literal handed to `defineModuleManifest`,
 * and only as data. Everything else in the file is ignored, which is not a
 * convenience: `cms`' manifest reads `process.env['CMS_PB_BREAKPOINT_TABLET_MIN']`
 * in its own settings defaults, so a manifest is **not** a literal file and a
 * reader that demanded one would refuse the very module whose declaration this
 * feature exists to collect.
 *
 * `null` is "this module declares no environment input", which is true of most
 * modules and is not a finding. A manifest with **no** `defineModuleManifest`
 * call is a {@link DeclarationUnreadableError}: a module whose manifest this run
 * cannot find is one it cannot report on, and reading that as "declares nothing"
 * is the silent skip the estate is against (issue #113).
 */
export function evaluateManifestEnvDeclaration(
  text: string,
  fileName: string,
): readonly unknown[] | null {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(fileName),
  );
  const literal = literalReader(source, fileName);

  let argument: ts.ObjectLiteralExpression | null = null;
  let sawFactory = false;
  const visit = (node: ts.Node): void => {
    if (
      argument === null &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === MANIFEST_FACTORY
    ) {
      sawFactory = true;
      const first = node.arguments[0];
      if (first !== undefined && ts.isObjectLiteralExpression(first)) argument = first;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (argument === null) {
    throw new DeclarationUnreadableError(
      sawFactory
        ? `${fileName}: \`${MANIFEST_FACTORY}\` is called with something other than an object ` +
          'literal, so this run cannot see what the module declares'
        : `${fileName}: no \`${MANIFEST_FACTORY}\` call — a module manifest this run cannot ` +
          'read is one it cannot report on, and "declares nothing" is not the same answer',
    );
  }

  for (const property of (argument as ts.ObjectLiteralExpression).properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = ts.isIdentifier(property.name)
      ? property.name.text
      : ts.isStringLiteral(property.name)
        ? property.name.text
        : null;
    if (key !== 'env') continue;
    const value = literal(property.initializer);
    if (!Array.isArray(value)) {
      throw new DeclarationUnreadableError(`${fileName}: \`env\` is not an array`);
    }
    return value;
  }
  return null;
}

/**
 * The Settings-debt ledger, read off disk one shard per module
 * (`contracts/environment-inputs.md` §4.2).
 *
 * Sharded because the debt is the module's: a repair that moves
 * `INVENTORY_LOW_STOCK_RECIPIENT` into Settings touches `inventory`'s manifest
 * and `inventory`'s shard, and nothing else. It is `check:module-boundary`'s
 * shape, one population over.
 *
 * Throws rather than returning a partial answer, and every throw is a caller's
 * exit 2: a ledger this run could not read in full is one it must not report
 * on, because the missing half reads as *"nobody has judged this"* for one
 * direction and as *"this entry describes nothing"* for the other — two
 * confident findings out of one silence.
 */
export async function loadModuleVerdictShards(directory: string): Promise<ModuleVerdictShard[]> {
  if (!existsSync(directory)) {
    throw new DeclarationUnreadableError(
      `${directory} is not there — the Settings-debt ledger is what says why a module-owned ` +
        'environment input is not a Setting, and a run that could not read it would report ' +
        'every module declaration as unjudged',
    );
  }
  const shards: ModuleVerdictShard[] = [];
  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith('.ts')) continue;
    const moduleId = name.replace(/\.ts$/, '');
    let loaded: unknown;
    try {
      loaded = (await import(pathToFileURL(join(directory, name)).href)) as unknown;
    } catch (error: unknown) {
      throw new DeclarationUnreadableError(
        `ledger shard '${moduleId}' failed to load: ${String(error)}`,
      );
    }
    const entries = (loaded as { entries?: unknown }).entries;
    if (typeof entries !== 'object' || entries === null) {
      throw new DeclarationUnreadableError(
        `ledger shard '${moduleId}' exports no \`entries\` record`,
      );
    }
    if (Object.keys(entries as object).length === 0) {
      // An empty shard is a done signal that says nothing: it satisfies every
      // presence test while judging no input, and it is the file left behind
      // when a module's last entry drains. Delete the file instead.
      throw new DeclarationUnreadableError(
        `ledger shard '${moduleId}' declares no entry — delete the file instead`,
      );
    }
    shards.push({
      moduleId,
      entries: entries as Readonly<Record<string, ModuleEnvironmentVerdict>>,
    });
  }
  return shards;
}
