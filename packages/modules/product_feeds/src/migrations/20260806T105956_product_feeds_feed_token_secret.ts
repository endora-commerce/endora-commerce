import { Migration } from '@mikro-orm/migrations';

/**
 * Keep the feed token recoverable so the admin can show its link again.
 *
 * Until now the token existed only as its sha256 (`token_hash`), following the
 * `api_keys` precedent, and the plaintext URL was shown exactly once. That is
 * the right model for a key a human types into a client; it is the wrong one
 * for a URL whose entire job is to be pasted into Google Merchant Center, Meta
 * and a marketplace panel, re-pasted when one of them is reconfigured, and
 * checked when a provider stops fetching. Operators cannot re-read it, so they
 * either rotate the token — breaking every provider already using it — or copy
 * it into a spreadsheet, which is a strictly worse place for it than this
 * database.
 *
 * So the plaintext is stored **encrypted at rest**, AES-256-GCM under
 * `SETTINGS_SECRET_ENCRYPTION_KEY`, exactly as the Ergonode API key and the
 * credential-configuration secret fields already are. `token_hash` stays and
 * remains the only thing the public route compares against: this column is
 * never read on the request path, only when an administrator with
 * `product_feeds:write` opens the feed.
 *
 * Nullable and unbackfilled on purpose. Tokens issued before this migration
 * genuinely cannot be recovered — the plaintext was never written anywhere —
 * so those feeds keep the masked display until the operator rotates.
 *
 * No foreign key, so the module's manifest `dependencies` are unchanged.
 */
export class Migration20260806T105956ProductFeedsFeedTokenSecret extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "product_feeds" add column "token_secret" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "product_feeds" drop column "token_secret";`);
  }
}
