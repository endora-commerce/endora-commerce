import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULES_ROOT = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
);

/**
 * Distinct permission codes referenced by `requireAdmin(...)` gates under
 * `backend/src/modules`. Used by the CI inventory contract test (SC-001).
 */
export function scanEnforcedPermissionCodes(): Set<string> {
  const codes = new Set<string>();
  walkDir(MODULES_ROOT, codes);
  return codes;
}

function walkDir(dir: string, codes: Set<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walkDir(path, codes);
      continue;
    }
    if (!entry.isFile() || !/\.(ts|js)$/.test(entry.name)) continue;
    collectFromSource(readFileSync(path, 'utf8'), codes);
  }
}

function collectFromSource(source: string, codes: Set<string>): void {
  const literalRe = /requireAdmin\??\.\s*\(\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = literalRe.exec(source)) !== null) {
    const code = m[1];
    if (code) codes.add(code);
  }

  const anyArrayRe = /requireAdminAny\(\s*\[([^\]]+)\]/g;
  while ((m = anyArrayRe.exec(source)) !== null) {
    const inner = m[1];
    if (!inner) continue;
    const itemRe = /['"]([^'"]+)['"]/g;
    let item: RegExpExecArray | null;
    while ((item = itemRe.exec(inner)) !== null) {
      const code = item[1];
      if (code) codes.add(code);
    }
  }

  const constMap = new Map<string, string>();
  const constRe = /(?:const|let)\s+(\w+)\s*=\s*['"]([a-z][\w.:]+)['"]/g;
  while ((m = constRe.exec(source)) !== null) {
    const name = m[1];
    const value = m[2];
    if (name && value) constMap.set(name, value);
  }

  const varRe = /requireAdmin\??\.\s*\(\s*(\w+)\s*\)/g;
  while ((m = varRe.exec(source)) !== null) {
    const name = m[1];
    if (!name) continue;
    const resolved = constMap.get(name);
    if (resolved) codes.add(resolved);
  }
}
