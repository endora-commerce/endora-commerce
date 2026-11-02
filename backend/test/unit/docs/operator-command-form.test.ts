import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * An operator command is written in the form an **instance** can run.
 *
 * `pnpm --filter backend run cli …` is the form for a checkout of this
 * repository. A scaffolded instance names its backend member
 * `<instance>-backend`, so there the filter matches no project: pnpm prints
 * `No projects matched the filters` and **exits 0** having run nothing. The
 * order repair command of `specs/142-order-transition-atomicity/` was
 * documented in that form only, and an operator following it after an upgrade
 * read a clean exit as "nothing is stranded".
 *
 * So wherever a published text names the repository form of a module's
 * operator command, the instance form — `pnpm run cli …`, run in the instance
 * root — has to be on the same page. A pending changeset is held to the
 * wider rule, any `pnpm --filter backend`, because its body becomes a
 * package's `CHANGELOG.md` and every reader of that file has an instance.
 *
 * Issue #133 widened the page rule from the `run cli` family to every script
 * an operator is sent to run ({@link OPERATOR_SCRIPTS}). A prefix swap is not
 * the answer for all of them: an instance has `search:reindex` only as the
 * module command behind `cli`, `migration:up` as `migrate`, and
 * `check:port-dependencies` not at all. So each family names the form an
 * instance runs, and a page that names the repository form has to give that
 * form **first** and label the repository one as a checkout's — the
 * convention `docs/docs/getting-started.md` set. The Polish pages are held to
 * the same rule, with the Polish label.
 */
const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');

const REPOSITORY_CLI_FORM = 'pnpm --filter backend run cli';
const REPOSITORY_FORM = 'pnpm --filter backend';
const INSTANCE_CLI_FORM = 'pnpm run cli';
const INSTANCE_FORM = /pnpm run [a-z]/;

/**
 * The scripts an operator of an instance is sent to run, each with the form an
 * instance runs it in — read from the instance scaffold
 * (`packages/cli/src/new-instance/template.ts`, the root `package.json`
 * scripts), not assumed to be the repository's name with a prefix swapped.
 * `instance: null` is a script an instance has no counterpart of; a page may
 * name it only labelled as a checkout's.
 */
interface OperatorScript {
  readonly repository: string;
  readonly instance: string | null;
}

const OPERATOR_SCRIPTS: readonly OperatorScript[] = [
  { repository: 'module:install', instance: 'pnpm run module:install' },
  { repository: 'module:uninstall', instance: 'pnpm run module:uninstall' },
  { repository: 'module:enable', instance: 'pnpm run module:enable' },
  { repository: 'module:disable', instance: 'pnpm run module:disable' },
  { repository: 'module:status', instance: 'pnpm run module:status' },
  // A module command behind the `cli` pass-through: the scaffold writes no
  // root alias for either, and needs none.
  { repository: 'cart:abandonment-sweep', instance: 'pnpm run cli carts abandonment-sweep' },
  { repository: 'search:reindex', instance: 'pnpm run cli search reindex' },
  { repository: 'start', instance: 'pnpm run start' },
  { repository: 'dev', instance: 'pnpm run dev' },
  { repository: 'worker', instance: 'pnpm run worker' },
  // An instance applies its migrations with `migrate`; it has no `migration:up`.
  { repository: 'migration:up', instance: 'pnpm run migrate' },
  { repository: 'setup', instance: 'pnpm run setup' },
  // A static check over this repository's module tree; an instance has no copy.
  { repository: 'check:port-dependencies', instance: null },
];

/** A script name ends where a name character cannot follow (`worker` is not `worker:dev`). */
const NAME_END = '(?![\\w:-])';
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const repositoryFormOf = (script: OperatorScript): RegExp =>
  new RegExp(`${escape(REPOSITORY_FORM)} run ${escape(script.repository)}${NAME_END}`);
const instanceFormOf = (instance: string): RegExp =>
  new RegExp(`${escape(instance)}${NAME_END}`);

/** The words a page labels the repository form with, per locale — across a line wrap. */
const CHECKOUT_LABEL: Readonly<Record<'en' | 'pl', RegExp>> = {
  en: /checkout\s+of\s+the\s+Endora\s+Commerce\s+repository/i,
  pl: /klon\w*\s+repozytorium\s+Endora\s+Commerce/i,
};

const POLISH_DOCS = 'docs/i18n/pl/docusaurus-plugin-content-docs/current';

/**
 * Pages whose only reader works in a checkout of this repository. Each entry
 * says why; a page an operator of an instance follows does not belong here.
 */
const CHECKOUT_ONLY_PAGES: ReadonlyMap<string, string> = new Map([
  [
    'docs/docs/operations/warden.md',
    'the Warden development environment for a checkout of this repository',
  ],
  [
    `${POLISH_DOCS}/operations/warden.md`,
    'the Polish page of the Warden development environment',
  ],
]);

function markdownUnder(directory: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules') continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...markdownUnder(path));
    else if (name.endsWith('.md') || name.endsWith('.mdx')) found.push(path);
  }
  return found;
}

function docsPages(): string[] {
  const modulesRoot = join(REPO_ROOT, 'packages/modules');
  const moduleDocs = readdirSync(modulesRoot)
    .map((id) => join(modulesRoot, id, 'docs'))
    .filter((directory) => statSync(directory, { throwIfNoEntry: false })?.isDirectory() === true);
  return [join(REPO_ROOT, 'docs/docs'), join(REPO_ROOT, POLISH_DOCS), ...moduleDocs]
    .flatMap(markdownUnder)
    .map((path) => relative(REPO_ROOT, path))
    .sort();
}

function pendingChangesets(): string[] {
  const directory = join(REPO_ROOT, '.changeset');
  return readdirSync(directory)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => join('.changeset', name))
    .sort();
}

const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

describe('operator commands are written in the form an instance can run', () => {
  it('finds the pages it is meant to hold', () => {
    expect(docsPages().length).toBeGreaterThan(50);
    expect(docsPages()).toContain('packages/modules/orders/docs/orders.md');
    expect(docsPages()).toContain('docs/docs/module-reference/orders.md');
    expect(docsPages()).toContain(`${POLISH_DOCS}/modules/orders.md`);
  });

  it('no docs page names the repository form of a module command without the instance form', () => {
    const offenders = docsPages().filter((path) => {
      if (CHECKOUT_ONLY_PAGES.has(path)) return false;
      const text = read(path);
      return text.includes(REPOSITORY_CLI_FORM) && !text.includes(INSTANCE_CLI_FORM);
    });
    expect(offenders).toEqual([]);
  });

  /**
   * Every operator script family (issue #133): a page that names the
   * repository form names the instance form first, and labels the repository
   * form as a checkout's. One offender line per page and script, so a red run
   * says what to fix where.
   */
  it('no docs page names the repository form of an operator script without the instance form first', () => {
    const offenders: string[] = [];
    for (const path of docsPages()) {
      if (CHECKOUT_ONLY_PAGES.has(path)) continue;
      const text = read(path);
      const label = CHECKOUT_LABEL[path.startsWith(POLISH_DOCS) ? 'pl' : 'en'];
      for (const script of OPERATOR_SCRIPTS) {
        const repository = repositoryFormOf(script).exec(text);
        if (repository === null) continue;
        if (!label.test(text)) {
          offenders.push(`${path}: \`${script.repository}\` is not labelled as a checkout's form`);
        }
        if (script.instance === null) continue;
        const instance = instanceFormOf(script.instance).exec(text);
        if (instance === null) {
          offenders.push(`${path}: \`${script.repository}\` without \`${script.instance}\``);
        } else if (instance.index > repository.index) {
          offenders.push(`${path}: \`${script.repository}\` before \`${script.instance}\``);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every operator script is matched by name, never by a longer name it prefixes', () => {
    const worker = OPERATOR_SCRIPTS.find((script) => script.repository === 'worker')!;
    expect(repositoryFormOf(worker).test('pnpm --filter backend run worker:dev')).toBe(false);
    expect(repositoryFormOf(worker).test('pnpm --filter backend run worker # built')).toBe(true);
    expect(instanceFormOf('pnpm run dev').test('pnpm run dev:infra')).toBe(false);
  });

  /**
   * The source usage comments an operator command's author copies from
   * (issue #133): `backend/src/cli.ts` and each module's `src/backend/cli/`.
   * The repository form needs the instance form beside it, and every usage
   * line addresses the command by its module id — `cms block-names`, not
   * `block-names`, which the dispatcher answers with `unknown module`.
   */
  it('no CLI usage comment gives the repository form alone, or a command without its module id', () => {
    const modulesRoot = join(REPO_ROOT, 'packages/modules');
    const sources: (readonly [string, string | null])[] = [['backend/src/cli.ts', null]];
    for (const directory of readdirSync(modulesRoot)) {
      const cli = join(modulesRoot, directory, 'src/backend/cli');
      if (statSync(cli, { throwIfNoEntry: false })?.isDirectory() !== true) continue;
      for (const name of readdirSync(cli).filter((file) => file.endsWith('.ts')).sort()) {
        sources.push([relative(REPO_ROOT, join(cli, name)), directory.replace(/^_/, '')]);
      }
    }
    expect(sources.length).toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const [path, moduleId] of sources) {
      const text = read(path);
      if (text.includes(REPOSITORY_CLI_FORM) && !text.includes(INSTANCE_CLI_FORM)) {
        offenders.push(`${path}: \`${REPOSITORY_CLI_FORM}\` without \`${INSTANCE_CLI_FORM}\``);
      }
      if (moduleId === null) continue;
      for (const [, addressed] of text.matchAll(/pnpm (?:--filter backend )?run cli (?:-- )?(\S+)/g)) {
        if (addressed !== moduleId) offenders.push(`${path}: \`run cli ${addressed!}\` names no module id`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no pending changeset names a repository-only command without the instance form', () => {
    const offenders = pendingChangesets().filter((path) => {
      const text = read(path);
      return text.includes(REPOSITORY_FORM) && !INSTANCE_FORM.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it('every exempted page still exists and still names the repository form', () => {
    for (const path of CHECKOUT_ONLY_PAGES.keys()) {
      expect(read(path), path).toContain(REPOSITORY_CLI_FORM);
    }
  });
});
