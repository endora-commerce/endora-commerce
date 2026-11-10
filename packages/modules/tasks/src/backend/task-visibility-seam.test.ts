import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { TASK_ACCESS_READERS } from './services/task-access.js';

/**
 * The visibility seam (`specs/165-task-management/` research R-3, R-21, T017)
 * — the Projects seam test (`project-access-seam.test.ts`) applied to Tasks.
 *
 * Every Task-owned entity is `@RuleScoped`, and **no ORM filter backs that
 * class**: a forgotten `em.findOne(Task, id)` or a `select … from "tasks"`
 * without the visibility pre-filter would hand any `tasks:read` holder a Task
 * of a Project they are not in, or somebody else's draft or private Task, and
 * no other test would notice until the route that does it is covered by a
 * not-found-identical case. This file is the guard against the forgotten path:
 * it parses every source under `routes/`, `services/` and `workers/` (and the
 * module's root files that touch data) and fails on any read of a rule-scoped
 * table outside `services/task-visibility.ts`, `services/task-access.ts` and
 * the files `task-access.ts` allow-lists, each with its reason, in
 * `TASK_ACCESS_READERS` — the sweeps of later stories (reminders, digest,
 * maintenance) join that list with theirs.
 *
 * A read is an entity-manager call naming a rule-scoped class, or SQL text
 * selecting, joining, updating or inserting into a rule-scoped table. The
 * rule-scoped set is derived from the entity declarations, never written down.
 */

const BACKEND = dirname(fileURLToPath(import.meta.url));
/** The two files that are the seam itself. */
const SEAM_FILES = new Set(['services/task-visibility.ts', 'services/task-access.ts']);

const ENTITY_READS = new Set([
  'find',
  'findOne',
  'findOneOrFail',
  'findAndCount',
  'findAll',
  'findByCursor',
  'count',
  'getReference',
  'getRepository',
  'nativeUpdate',
  'nativeDelete',
  'upsert',
  'upsertMany',
  'stream',
  'populate',
]);

/** Every way into SQL the detector cannot read: a statement may be built from anything. */
const RAW_SQL_ENTRIES = new Set(['execute', 'getConnection', 'getKnex', 'raw', 'createQueryBuilder', 'qb']);

interface RuleScopedEntity {
  className: string;
  tableName: string;
}

function parse(file: string, text = readFileSync(file, 'utf8')): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function decoratorName(decorator: ts.Decorator): string | null {
  const expression = decorator.expression;
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) return expression.expression.text;
  if (ts.isIdentifier(expression)) return expression.text;
  return null;
}

/** Every class under `entities/` decorated `@RuleScoped()`, with its table. */
function ruleScopedEntities(): RuleScopedEntity[] {
  const found: RuleScopedEntity[] = [];
  const dir = join(BACKEND, 'entities');
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.entity.ts')).sort()) {
    const source = parse(join(dir, name));
    for (const statement of source.statements) {
      if (!ts.isClassDeclaration(statement) || !statement.name) continue;
      const decorators = ts.getDecorators(statement) ?? [];
      if (!decorators.some((d) => decoratorName(d) === 'RuleScoped')) continue;
      const entity = decorators.find((d) => decoratorName(d) === 'Entity');
      let tableName: string | null = null;
      if (entity && ts.isCallExpression(entity.expression)) {
        const options = entity.expression.arguments[0];
        if (options && ts.isObjectLiteralExpression(options)) {
          for (const property of options.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              ts.isIdentifier(property.name) &&
              property.name.text === 'tableName' &&
              ts.isStringLiteralLike(property.initializer)
            ) {
              tableName = property.initializer.text;
            }
          }
        }
      }
      if (!tableName) throw new Error(`${name}: @RuleScoped class ${statement.name.text} declares no tableName`);
      found.push({ className: statement.name.text, tableName });
    }
  }
  return found;
}

/** The sources the seam scans: `routes/`, `services/`, `workers/`, and the module's root files that touch data. */
function scanned(): string[] {
  return [
    ...sources('routes'),
    ...sources('services'),
    ...sources('workers'),
    'index.ts',
    'admin-search-provider.ts',
  ].sort();
}

/** Every `.ts` source under `dir`, tests excluded, relative to the backend root. */
function sources(dir: string): string[] {
  const root = join(BACKEND, dir);
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sources(join(dir, entry)));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      out.push(relative(BACKEND, path).split(sep).join('/'));
    }
  }
  return out.sort();
}

/**
 * The reads of a rule-scoped table in one source, as `line: what` strings.
 * Exported shape for the detector's own cases below.
 */
function readsIn(source: ts.SourceFile, entities: readonly RuleScopedEntity[]): string[] {
  const classes = new Set(entities.map((e) => e.className));
  const tables = new Set(entities.map((e) => e.tableName));
  const sqlTable = /\b(?:from|join|update|insert\s+into)\s+"?([a-z_]+)"?/gi;
  const found: string[] = [];
  const at = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const first = node.arguments[0];
      if (ENTITY_READS.has(method) && first) {
        const named = ts.isIdentifier(first) ? first.text : ts.isStringLiteralLike(first) ? first.text : null;
        if (named && classes.has(named)) found.push(`${at(node)}: ${method}(${named})`);
      }
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      for (const match of node.text.matchAll(sqlTable)) {
        const table = match[1]!.toLowerCase();
        if (tables.has(table)) found.push(`${at(node)}: SQL reads "${table}"`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The calls into raw SQL in one source, as `line: name` strings. */
function rawSqlIn(source: ts.SourceFile): string[] {
  const found: string[] = [];
  const at = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : null;
      if (name && RAW_SQL_ENTRIES.has(name)) found.push(`${at(node)}: ${name}(`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * Files that run SQL but read no rule-scoped table — each with why. The test
 * holds both halves: they do run SQL (no stale entry) and read no rule-scoped
 * table (else they belong in `TASK_ACCESS_READERS`).
 */
const SQL_WITHOUT_RULE_SCOPED_TABLES: Readonly<Record<string, string>> = {
  'services/task-number.ts': 'Draws the next Task number from its sequence — no row of any Task.',
  'services/scheduled-work-probe.ts':
    'The scheduled-work probe helper (issue #120), identical in every module with a probe: it runs the ' +
    '`exists(…)` its caller hands it and answers one bit. Its callers — the reminder and digest passes — are ' +
    'readers with their reasons, and the row sources are theirs.',
  'services/saved-view-service.ts':
    'A saved view of the Tasks list (feature 147): an advisory lock keyed on the view owner and a name probe ' +
    'over `task_list_saved_views` — an administrator\'s own preset, never a row of any Task.',
};

/**
 * How many reads of a rule-scoped table each allowed file makes. A change that
 * adds or removes one moves its count here, in the same change, after the read
 * has been checked to compose the visibility pre-filter or to be keyed by an id
 * `TaskAccess` (or such a read) handed out.
 */
const RULE_SCOPED_READ_LEDGER: Readonly<Record<string, number>> = {
  'services/attachment-service.ts': 5,
  'services/comment-service.ts': 4,
  'services/digest-service.ts': 2,
  'services/hierarchy-service.ts': 5,
  'services/maintenance-service.ts': 4,
  'services/priority-service.ts': 2,
  'services/record-link-service.ts': 3,
  'services/relation-service.ts': 2,
  'services/reminder-schedule.ts': 3,
  'services/reminder-service.ts': 12,
  'services/tag-service.ts': 3,
  'services/task-access.ts': 3,
  'services/task-asset-references.ts': 5,
  'services/task-commands.ts': 9,
  'services/task-history-service.ts': 1,
  'services/task-service.ts': 21,
  'services/task-visibility.ts': 0,
  'services/task-reassignment.ts': 1,
  'services/task-write-port.ts': 2,
  'services/workflow-config-service.ts': 2,
};

describe('the Task visibility seam (R-3, R-21)', () => {
  const entities = ruleScopedEntities();

  it('derives the rule-scoped set from the entity declarations — `tasks` and every table owned by a Task', () => {
    expect(entities.map((e) => e.tableName).sort()).toEqual(
      [
        'task_assignees',
        'task_attachments',
        'task_comments',
        'task_record_links',
        'task_references',
        'task_relations',
        'task_reminder_deliveries',
        'task_reminders',
        'task_tag_assignments',
        // Issue #470 — what a Task's writes changed, with the values.
        'task_value_changes',
        'tasks',
      ].sort(),
    );
  });

  const allowed = (file: string) => SEAM_FILES.has(file) || file in TASK_ACCESS_READERS;

  it('nothing the module runs reads a rule-scoped table outside TaskVisibility, TaskAccess and its allow-list', () => {
    const offenders: string[] = [];
    for (const file of scanned()) {
      if (allowed(file)) continue;
      for (const read of readsIn(parse(join(BACKEND, file)), entities)) offenders.push(`${file}:${read}`);
    }
    expect(offenders, 'read the Task through TaskAccess / the visibility pre-filter').toEqual([]);
  });

  it('no other file reaches raw SQL at all — a statement built from a variable is not a literal the scan can see', () => {
    const offenders: string[] = [];
    for (const file of scanned()) {
      if (allowed(file) || file in SQL_WITHOUT_RULE_SCOPED_TABLES) continue;
      for (const call of rawSqlIn(parse(join(BACKEND, file)))) offenders.push(`${file}:${call}`);
    }
    expect(offenders, 'run SQL in TaskAccess or an allowed reader, or name the file with its reason').toEqual([]);
  });

  it('every file that runs SQL without a rule-scoped table exists, says why, runs SQL and reads no such table', () => {
    const all = new Set(scanned());
    for (const [file, reason] of Object.entries(SQL_WITHOUT_RULE_SCOPED_TABLES)) {
      expect(all.has(file), `${file} is listed but is not a scanned source`).toBe(true);
      expect(file in TASK_ACCESS_READERS, `${file} is on both lists`).toBe(false);
      expect(reason.trim().length, `${file} is listed without a reason`).toBeGreaterThan(20);
      const source = parse(join(BACKEND, file));
      expect(rawSqlIn(source), `${file} is listed but runs no SQL — remove the entry`).not.toEqual([]);
      expect(readsIn(source, entities), `${file} reads a rule-scoped table — it is a reader, with a reason`).toEqual([]);
    }
  });

  it('every allow-listed file exists, says why, and does read a rule-scoped table — no stale entry', () => {
    const all = new Set(scanned());
    for (const [file, reason] of Object.entries(TASK_ACCESS_READERS)) {
      expect(all.has(file), `${file} is allow-listed but is not a scanned source`).toBe(true);
      expect(SEAM_FILES.has(file), `${file} is the seam itself, not a reader`).toBe(false);
      expect(reason.trim().length, `${file} is allow-listed without a reason`).toBeGreaterThan(20);
      expect(
        readsIn(parse(join(BACKEND, file)), entities),
        `${file} is allow-listed but reads no rule-scoped table — remove the entry`,
      ).not.toEqual([]);
    }
  });

  it('the reads of each allowed file are counted — a new one is a reviewed bump of the ledger', () => {
    const counted: Record<string, number> = {};
    for (const file of [...SEAM_FILES, ...Object.keys(TASK_ACCESS_READERS)].sort()) {
      counted[file] = readsIn(parse(join(BACKEND, file)), entities).length;
    }
    expect(counted).toEqual(RULE_SCOPED_READ_LEDGER);
  });

  describe('the detector itself', () => {
    const probe = [{ className: 'Task', tableName: 'tasks' }, { className: 'TaskAssignee', tableName: 'task_assignees' }];
    const check = (text: string) => readsIn(parse('probe.ts', text), probe);

    it('finds an entity-manager read naming a rule-scoped class', () => {
      expect(check(`await em.findOne(Task, { id });`)).toEqual(['1: findOne(Task)']);
      expect(check(`await this.deps.em().find(TaskAssignee, {});`)).toEqual(['1: find(TaskAssignee)']);
      expect(check(`em.findOneOrFail('Task', id)`)).toEqual(['1: findOneOrFail(Task)']);
      expect(check(`em.getRepository(Task)`)).toEqual(['1: getRepository(Task)']);
    });

    it('finds SQL selecting or joining a rule-scoped table, quoted or not', () => {
      expect(check('execute(`select * from "tasks" p where p.id = ?`)')).toEqual(['1: SQL reads "tasks"']);
      expect(check(`execute('select 1 from x join task_assignees s on true')`)).toEqual(['1: SQL reads "task_assignees"']);
      expect(check('execute(`select ${cols} from "task_assignees" s`)')).toEqual(['1: SQL reads "task_assignees"']);
    });

    it('finds a write that hands rows back, and the entity-manager writes, as reads', () => {
      expect(check('execute(`update "tasks" set "title" = ? where "id" = ? returning *`)')).toEqual([
        '1: SQL reads "tasks"',
      ]);
      expect(check(`execute('insert into "task_assignees" ("id") values (?) returning "id"')`)).toEqual([
        '1: SQL reads "task_assignees"',
      ]);
      expect(check(`em.nativeUpdate(Task, { id }, { title }); em.nativeDelete(TaskAssignee, {});`)).toEqual([
        '1: nativeUpdate(Task)',
        '1: nativeDelete(TaskAssignee)',
      ]);
      expect(check(`em.upsert(Task, row); em.findByCursor(Task, {}); em.stream(TaskAssignee)`)).toEqual([
        '1: upsert(Task)',
        '1: findByCursor(Task)',
        '1: stream(TaskAssignee)',
      ]);
    });

    it('leaves alone what is not a read of a rule-scoped table', () => {
      expect(check(`em.findOne(TaskStatus, id); em.persist(project); execute('select 1 from "task_statuses"');`)).toEqual([]);
      expect(check(`commandBus.run({ action: 'tasks.task.update' })`)).toEqual([]);
    });

    it('finds every way into raw SQL, whatever the statement is built from', () => {
      const raw = (text: string) => rawSqlIn(parse('probe.ts', text));
      expect(raw('await em.execute(statement, params);')).toEqual(['1: execute(']);
      expect(raw('em.getConnection().execute(sql)')).toEqual(['1: execute(', '1: getConnection(']);
      expect(raw('em.getKnex().raw(sql); em.createQueryBuilder(Task); em.qb(Task); qb(x)')).toEqual([
        '1: raw(',
        '1: getKnex(',
        '1: createQueryBuilder(',
        '1: qb(',
        '1: qb(',
      ]);
      expect(raw('em.find(TaskStatus, {}); em.persist(x)')).toEqual([]);
    });
  });
});
