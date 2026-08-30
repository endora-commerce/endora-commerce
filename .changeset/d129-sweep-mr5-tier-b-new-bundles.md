---
'@endora-commerce/mod-credit-limits': patch
'@endora-commerce/mod-api-keys': patch
'@endora-commerce/mod-addresses': patch
'@endora-commerce/mod-webhooks': patch
'@endora-commerce/mod-i18n': patch
---

Error-code ownership: Tier B's four remaining modules declare the codes they own, each shipping its
first i18n bundle.

`manifest.errorCodes` gains five codes on `@endora-commerce/mod-credit-limits`
(`ACTIVE_RESERVATIONS_EXIST`, `ADJUSTMENT_BELOW_ACTIVE`, `CREDIT_LIMIT_ALREADY_GRANTED`,
`CREDIT_LIMIT_NOT_GRANTED`, `LIMIT_INSUFFICIENT`), three on `@endora-commerce/mod-api-keys`
(`API_KEY_CHANNEL_MISMATCH`, `API_KEY_NOT_BOUND`, `API_KEY_OUT_OF_SCOPE`), two on
`@endora-commerce/mod-addresses` (`ADDRESS_IN_USE`, `ADDRESS_NOT_OWNED`) and one on
`@endora-commerce/mod-webhooks` (`WEBHOOK_DELIVERY_NOT_REPLAYABLE`); `@endora-commerce/mod-i18n`
drops the same eleven from its own declaration, which is what decides where the error envelope
looks for a sentence (D-129's remaining sweep, MR 5 of eight; D-121 tier T1 throughout; D-186 §2
and §3 in `specs/080-f4-real-scope/rulings.md`;
`specs/090-module-owned-error-codes/d129-sweep.md`).

All four declare an error code for the first time, and all four gain an `i18n` bundle they never
had, declared as `i18n: { bundlesDir: 'i18n' }` and shipped in `files`. No wire shape moves:
`error.code` is unchanged for all eleven.

**Nine sentences are deleted from `@endora-commerce/mod-i18n`'s bundle, and this is
operator-visible.** Each was the error code rewritten twice — `"Limit Insufficient."` in `en` and
`"Błąd: limit insufficient."` in `pl` — which D-186 §2 refuses to carry into a module's own bundle,
where it would read as that module's answer rather than as an unwritten sentence. Six of the nine
are replaced by real prose in both languages in the receiving module's own bundle:

- `errors.ADJUSTMENT_BELOW_ACTIVE`, `errors.CREDIT_LIMIT_ALREADY_GRANTED`,
  `errors.CREDIT_LIMIT_NOT_GRANTED` and `errors.LIMIT_INSUFFICIENT` in
  `@endora-commerce/mod-credit-limits`
- `errors.ADDRESS_NOT_OWNED` in `@endora-commerce/mod-addresses`
- `errors.WEBHOOK_DELIVERY_NOT_REPLAYABLE` in `@endora-commerce/mod-webhooks`

The other three keep no sentence. `ACTIVE_RESERVATIONS_EXIST` and `ADDRESS_IN_USE` are raised by
nothing in the platform, so there was no refusal to describe. `API_KEY_OUT_OF_SCOPE` is raised, and
is still not rewritten: its reader is an integration rather than a person, and the raise names the
scope the key is missing (`API key lacks the required scope: <scope>.`) — the envelope substitutes
the message wholesale and that raise carries no `details`, so a fixed sentence would take
information away from the only audience that meets it. A consumer that reads those three keys out
of `@endora-commerce/mod-i18n`'s bundle directly will no longer find them.

`@endora-commerce/mod-api-keys` therefore ships a bundle that installs **zero** entries, which is a
state no module in this platform has been in before. `loadModuleBundles` answers
`{"byLanguage":{}}` for it and the boot reconciler counts it as installed.

`API_KEY_CHANNEL_MISMATCH` is raised by the platform's sales-channel resolver and now takes its
sentence from a switchable module's bundle (D-186 §3). The coupling is bounded: the raise needs an
`api_key` actor, which only `@endora-commerce/mod-auth`'s request hook produces and only by calling
`@endora-commerce/mod-api-keys`' gated `apiKeyResolver`, so with the module absent the code cannot
be produced at all.
