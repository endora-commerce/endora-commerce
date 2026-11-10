import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildTableOwners, scanModuleBoundaryTree } from '../check-module-boundary.js';
import { closureOf, loadManifestDependencies } from './manifest-dependencies.js';
import { requireModuleLayout } from './module-roots.js';

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
