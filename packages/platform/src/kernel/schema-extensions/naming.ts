import { createHash } from 'node:crypto';

/**
 * Physical names of declared extension elements
 * (`contracts/generated-ddl-and-ledger.md` §2, `data-model.md` §2).
 */

/** PostgreSQL's identifier limit, in bytes (`NAMEDATALEN - 1`). */
export const MAX_IDENTIFIER_BYTES = 63;

/** `erpCode` → `erp_code`. Keys are `^[a-z][a-zA-Z0-9]*$`, so this is total. */
export function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** `x_<moduleId>_<snake_case(key)>`. */
export function physicalColumnName(moduleId: string, key: string): string {
  return `x_${moduleId}_${snakeCase(key)}`;
}

/** The prefix every column of `moduleId` carries — what the verifier and reconcile read by. */
export function physicalColumnPrefix(moduleId: string): string {
  return `x_${moduleId}_`;
}

/**
 * `ix_<host>_<col>` / `ux_<host>_<col>` when that fits in 63 bytes, else
 * `ix_x_<16 hex of sha256("<host>.<col>")>` / `ux_x_…`.
 */
export function indexName(host: string, column: string, unique: boolean): string {
  const kind = unique ? 'ux' : 'ix';
  const plain = `${kind}_${host}_${column}`;
  if (Buffer.byteLength(plain, 'utf8') <= MAX_IDENTIFIER_BYTES) return plain;
  const digest = createHash('sha256').update(`${host}.${column}`).digest('hex').slice(0, 16);
  return `${kind}_x_${digest}`;
}
