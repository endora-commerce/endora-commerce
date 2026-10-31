import type { BulkOperationLogEntry } from '@endora-commerce/contracts';

/**
 * The sentence the bulk-operations screen draws for one log entry, in the
 * reader's language: the entry's `messageKey` resolved in `catalog`'s bundle,
 * else — an entry written before keys existed, or a key this bundle does not
 * carry — the English `message` the entry stores beside it (issue #95).
 */
export function bulkOperationLogText(
  t: (key: string, params?: Record<string, string | number>) => string,
  entry: Pick<BulkOperationLogEntry, 'message' | 'messageKey'>,
): string {
  if (!entry.messageKey) return entry.message;
  const text = t(entry.messageKey.key, entry.messageKey.params);
  return text === `catalog.${entry.messageKey.key}` ? entry.message : text;
}
