import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';
import {
  requiredModulesOf,
  reverseEdgeClause,
  sqlWriteTargets,
  type ReverseEdgeClause,
} from '@endora-commerce/platform/db';

import { buildTableOwners, scanModuleBoundaryTree } from '../check-module-boundary.js';
import { closureOf, loadManifestDependencies } from './manifest-dependencies.js';
import { requireModuleLayout } from './module-roots.js';
import { declaredIndexes } from './sql-tables.js';

/**
 * The first-party D-226 bridges (`specs/178-extensible-columns/` D-291 R-A6,
 * tasks.md T071) — the one exemption from "a package migration may not destroy
 * a table another module's entity maps".
 *
 * D-226's bridge rule: a bridge between an always-present near side and a
 * switchable far side belongs to the far side, because only the far side can be
 * ordered after both tables. So a **bridge** is a table a migration of module W
 * creates while another module O's entity maps it, where O is in W's dependency
 * closure (the far side declares the near side) and the table references both a
 * table W owns and a table O owns — the two sides it bridges. A pre-split init
 * that created another module's table referencing only that module's side is no
 * bridge, and its `down()` stays refused.
 *
 * Derived, never listed: the owner map is `check:module-boundary`'s own
 * (`buildTableOwners`, entity first) and the closure the manifests'. Each entry
 * names the direction its migration destroys the table in.
 */

export interface BridgeExemption {
  readonly moduleId: string;
  readonly migration: string;
  readonly table: string;
  readonly kind: 'bridge';
  readonly direction: 'up' | 'down';
}

const CREATE = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\)\s*;?\s*`/gi;
const REFERENCES = /\breferences\s+"?([a-z_][a-z0-9_]*)"?/gi;

function destroysIn(text: string, table: string): boolean {
  const t = `"?${table}"?`;
  return new RegExp(
    String.raw`\b(?:drop\s+table\s+(?:if\s+exists\s+)?[^;\`]*\b${t}|truncate\s+(?:table\s+)?${t}|alter\s+table\s+(?:if\s+exists\s+)?${t}[^;\`]*\bdrop\b)`,
    'i',
  ).test(text);
}

/** The bridge entries one migration source yields — a function over text, so a proof enters here. */
export function bridgeEntriesOf(
  moduleId: string,
  text: string,
  owners: ReadonlyMap<string, string>,
  closures: ReadonlyMap<string, ReadonlySet<string>>,
): BridgeExemption[] {
  const declared = /export class (Migration\w+)/.exec(text);
  if (declared === null) return [];
  const downAt = text.search(/\basync\s+down\s*\(/);
  const upText = downAt === -1 ? text : text.slice(0, downAt);
  const downText = downAt === -1 ? '' : text.slice(downAt);
  const out: BridgeExemption[] = [];
  for (const match of upText.matchAll(CREATE)) {
    const table = match[1]!.toLowerCase();
    const owner = owners.get(table);
    if (owner === undefined || owner === moduleId) continue;
    if (!(closures.get(moduleId)?.has(owner) ?? false)) continue;
    const referenced = [...match[2]!.matchAll(REFERENCES)].map((ref) => owners.get(ref[1]!.toLowerCase()));
    if (!referenced.includes(moduleId) || !referenced.includes(owner)) continue;
    for (const [direction, part] of [['up', upText], ['down', downText]] as const) {
      if (destroysIn(part, table)) {
        out.push({ moduleId, migration: declared[1]!, table, kind: 'bridge', direction });
      }
    }
  }
  return out;
}

/** Every bridge entry over this repository's first-party migrations. */
export async function firstPartyBridges(): Promise<BridgeExemption[]> {
  const layout = await requireModuleLayout('[first-party-bridges]');
  const scan = await scanModuleBoundaryTree(layout);
  const owners = new Map(
    [...buildTableOwners(scan.input.schema, scan.input.packageTables, scan.input.hostResidentModules).owners].map(
      ([table, owner]) => [table, owner.id] as const,
    ),
  );
  const dependencies = await loadManifestDependencies(layout.manifestIndexPath);
  const closures = new Map(layout.registeredIds.map((id) => [id, closureOf(id, dependencies)] as const));
  const out: BridgeExemption[] = [];
  for (const moduleId of [...layout.registeredIds].sort()) {
    const root = layout.moduleDirectoryOf(moduleId);
    if (root === null) continue;
    for (const directory of [join(root, 'src', 'migrations'), join(root, 'migrations')]) {
      if (!existsSync(directory)) continue;
      for (const name of readdirSync(directory).sort()) {
        if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name === 'index.ts') continue;
        out.push(...bridgeEntriesOf(moduleId, readFileSync(join(directory, name), 'utf8'), owners, closures));
      }
    }
  }
  return out;
}

export interface DerivedDownExemption {
  readonly moduleId: string;
  readonly migration: string;
  readonly table: string;
  readonly kind: 'derived-down';
  readonly direction: 'down';
  readonly clause: ReverseEdgeClause;
}

/** The literal texts inside a method named `down`, substitutions as `?`. */
function downLiterals(text: string, file: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node, inside: boolean): void => {
    const here = inside || (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'down');
    if (here && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) out.push(node.text);
    else if (here && ts.isTemplateExpression(node)) {
      let spliced = node.head.text;
      for (const span of node.templateSpans) spliced += ` ? ${span.literal.text}`;
      out.push(spliced);
    }
    node.forEachChild((child) => visit(child, here));
  };
  source.forEachChild((child) => visit(child, false));
  return out;
}

const DESTROYS = (target: { verb: string; destructive?: boolean }): boolean =>
  target.verb === 'drop' ||
  target.verb === 'truncate' ||
  target.verb === 'drop-index' ||
  (target.verb === 'alter' && target.destructive === true);

/**
 * D-291 R-A7 — every first-party `down()` destruction of a table another module
 * owns that the shared predicate (`reverseEdgeClause`) exempts, with its
 * clause. Rendered by `composer:generate` as `derived-down` entries; the guard
 * reaches the same verdict at run time, and these entries make that verdict
 * independent of which manifests an instance happens to read.
 */
export async function firstPartyDerivedDowns(): Promise<DerivedDownExemption[]> {
  const layout = await requireModuleLayout('[first-party-derived-downs]');
  const scan = await scanModuleBoundaryTree(layout);
  const owners = new Map(
    [...buildTableOwners(scan.input.schema, scan.input.packageTables, scan.input.hostResidentModules).owners].map(
      ([table, owner]) => [table, owner.id] as const,
    ),
  );
  const dependencies = await loadManifestDependencies(layout.manifestIndexPath);
  const { DISCOVERED_MANIFESTS } = (await import(pathToFileURL(layout.manifestIndexPath).href)) as {
    DISCOVERED_MANIFESTS: ReadonlyArray<{ id: string; manifest: { activation?: unknown } }>;
  };
  const required = requiredModulesOf(DISCOVERED_MANIFESTS);
  const files: Array<{ moduleId: string; file: string; text: string }> = [];
  for (const moduleId of [...layout.registeredIds].sort()) {
    const root = layout.moduleDirectoryOf(moduleId);
    if (root === null) continue;
    for (const directory of [join(root, 'src', 'migrations'), join(root, 'migrations')]) {
      if (!existsSync(directory)) continue;
      for (const name of readdirSync(directory).sort()) {
        if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name === 'index.ts') continue;
        const file = join(directory, name);
        files.push({ moduleId, file, text: readFileSync(file, 'utf8') });
      }
    }
  }
  const indexTables = new Map<string, string>();
  for (const { file, text } of files) for (const { index, table } of declaredIndexes(text, file)) indexTables.set(index, table);

  const seen = new Set<string>();
  const out: DerivedDownExemption[] = [];
  for (const { moduleId, file, text } of files) {
    const declared = /export class (Migration\w+)/.exec(text);
    if (declared === null) continue;
    for (const literal of downLiterals(text, file)) {
      for (const target of sqlWriteTargets(literal)) {
        if (!DESTROYS(target)) continue;
        const table = target.table ?? (target.index === undefined ? undefined : indexTables.get(target.index));
        if (table === undefined || table === null) continue;
        const owner = owners.get(table);
        if (owner === undefined || owner === moduleId || owner === 'kernel' || owner.startsWith('core:')) continue;
        const clause = reverseEdgeClause({ writer: moduleId, owner, dependencies, required });
        if (clause === null) continue;
        const key = `${moduleId} ${declared[1]} ${table}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ moduleId, migration: declared[1]!, table, kind: 'derived-down', direction: 'down', clause });
      }
    }
  }
  return out;
}
