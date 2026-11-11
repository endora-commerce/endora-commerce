# Contract: Core column-preservation test (FR-080)

File: `backend/test/integration/db/schema-extension-preservation.test.ts`. Runs in `test:backend`
(post-merge on `master`, D-198); `check:extensible-tables` is the merge-request half.

1. Fresh throwaway database; the full configured migration order (core composition, no packages).
2. Apply migrations one at a time (`migrator.up({ migrations: [name], transaction })`). After each,
   for every extensible table that now exists and is not yet seeded, add:
   - `x_fixture_note text null`,
   - `x_fixture_flag boolean not null default false`,
   - `x_fixture_code varchar(32) null` with `create unique index … where x_fixture_code is not null`,
   recording which migration created the table.
3. Continue to the end. Assert every fixture column exists with its type, nullability and default,
   and the index exists, on all extensible tables (until Phase D: the rolled-out list; the test reads
   the same derived list the platform uses).
4. Failure message names the table, the missing element and the first migration after which it was
   absent (re-checked after each step for seeded tables).

Cost budget: one `information_schema` query per step; measured and recorded in the test header on
first run. If over 120 s, switch to checkpointing at the creating migrations only.
