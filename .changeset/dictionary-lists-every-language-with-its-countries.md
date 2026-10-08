---
'@endora-commerce/mod-dictionaries': minor
'@endora-commerce/mod-languages': minor
'@endora-commerce/contracts': minor
'@endora-commerce/mod-orders': patch
---

The Dictionary's Languages tab lists every ISO 639-1 language, each with the countries that use it.

- **183 languages are seeded, inactive.** `mod-dictionaries` ships a static catalogue — code,
  English name, native name, text direction and ISO 3166-1 country codes — and its boot reconciler
  inserts the rows that are missing, so an existing installation receives them on its first boot
  after the upgrade. No migration and no new dependency. `en-US` and `pl-PL` stay the only active
  languages: the storefront registry, `GET /api/v1/i18n/config`, the catalogue's translation chains
  and the product feeds read the *active* set and are unchanged. An operator activates a language on
  its row to start using it.
- **Seeding never overwrites.** A language row that exists is left exactly as it is — label, sort
  order and activation included. A seeded row that is deleted returns on the next boot; leave it
  inactive instead. A language is linked only to countries the dictionary holds, never as the
  country's primary language, and a country added later is linked on the next boot.
- **`LanguageSeedPort` gains `ensureSeeded(rows: readonly LanguageSeedRow[]): Promise<number>`**,
  and `@endora-commerce/contracts` exports `LanguageSeedRow`. It inserts every row whose `code` is
  missing with `is_active = false` and returns how many it inserted. An implementation of the port
  outside `mod-languages` has to add the method; a caller of `backfillNativeLabels` changes nothing.
- **Admin.** The Countries column shows country-code chips instead of a count; the list is searchable
  by country, filterable by status and paged; translation completeness is requested for active
  languages only, and the translations panel offers active languages only (the backend already
  refused a label in an inactive one). `GET /api/v1/admin/dictionary/languages` builds its answer in
  two statements instead of one per language.
- **A code that used to be unknown is now inactive.** A write naming a catalogue language that has
  not been activated — `de` on a sales channel, say — answers `409 DICTIONARY_ENTRY_INACTIVE` where
  it answered `409 DICTIONARY_ENTRY_NOT_FOUND`.
- `mod-orders`: the order-status screen asks the dictionary for its full page of languages, so an
  active language cannot fall outside the first hundred rows.
