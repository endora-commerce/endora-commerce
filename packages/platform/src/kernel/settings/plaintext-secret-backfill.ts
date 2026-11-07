import type { EntityManager } from '@mikro-orm/postgresql';

// Red-phase stub for issue #700; the implementation follows in the next commit.
export async function backfillPlaintextSecrets(
  _em: EntityManager,
  _options: Record<string, unknown> = {},
): Promise<{ encryptedCodes: readonly string[] }> {
  throw new Error('not implemented');
}
