import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 160 (US7; G5 of `specs/161-price-book-editor/`) — a price book's
 * `version` and `ever_activated` (`specs/160-pricing-model-v2/data-model.md` §1).
 *
 * - `version` moves on every write to the book — header, channel set, members,
 *   rows, activation — and a write that names an older one is refused
 *   `409 PRICE_BOOK_STALE`, so two editors cannot overwrite each other silently.
 * - `ever_activated` is set by the first activation and never cleared: the
 *   audience kind of a book is immutable from then on (FR-004). A book that is
 *   not a draft today, and every base book, has been active.
 *
 * Both columns are this module's own table; nothing else references them.
 */
export class Migration20261021T232310PriceListsPriceBooksVersion extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "price_lists" add column if not exists "version" integer not null default 1;`);
    this.addSql(
      `alter table "price_lists" add column if not exists "ever_activated" boolean not null default false;`,
    );
    this.addSql(
      `update "price_lists" set "ever_activated" = true where "status" <> 'draft' or "is_system" = true;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "price_lists" drop column if exists "ever_activated";`);
    this.addSql(`alter table "price_lists" drop column if exists "version";`);
  }
}
