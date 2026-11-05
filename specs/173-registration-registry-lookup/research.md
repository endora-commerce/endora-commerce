# Research: Company registry lookup at storefront registration

Every decision is stated as **decision → rationale → rejected alternatives**. Facts about the three
external registries that this tree cannot prove are marked **(verify in T001)**: the throwaway spike
in `tasks.md` confirms them against the live test environments before any client code is written,
and corrects this file if one is wrong. The spike leaves nothing in the tree.

---

## R-1 — Where the feature lives

**Decision.** Extend `organizations` (OD-2). The new backend code goes in one new directory,
`packages/modules/organizations/src/backend/registry-lookup/`, beside the existing
`integrations/` that keeps the three HTTP clients.

**Rationale.** `organizations` owns registration, the `OrganizationTaxIdValidation` history and the
two registry clients already; a lookup is the same registry knowledge used one step earlier. The
module is `nonDeactivatable` (`src/manifest.ts`, `activation`), so "on/off" is a feature setting,
not module activation (R-16).

**Rejected.** A new module — ruled out by OD-2, and it would need a port into `organizations` for
the very registration write it exists to feed. `customers` — it consumes `vatValidatorPort` for its
own admin screens and owns neither registration nor the history table.

---

## R-2 — A new module-internal result type, not a wider `VatValidationResult`

**Decision.** A new internal port in `registry-lookup/company-registry-port.ts`:

```ts
type RegistryProvider = 'gus_pl' | 'mf_pl' | 'vies';
interface CompanyRegistryAnswer {
  provider: RegistryProvider;
  outcome: 'found' | 'not_found' | 'unavailable';
  record: CompanyRegistryRecord | null;   // non-null only when found
  errorKind: string | null;               // 'network_timeout', 'gus_session', 'rate_limited', …
}
interface CompanyRegistryRecord {
  legalName: string | null;
  address: { street: string | null; postalCode: string | null; city: string | null; country: string };
  regon: string | null;
  vatPayerStatus: 'active' | 'exempt' | 'not_registered' | 'unknown';
  activityStatus: 'active' | 'ceased' | 'unknown';
}
interface CompanyRegistryClient {
  readonly provider: RegistryProvider;
  lookup(input: { taxId: string /* normalised, no prefix */; country: string }): Promise<CompanyRegistryAnswer>;
}
```

`VatValidationResult` and `VatValidator` in `packages/contracts/src/organizations.ts` stay as they
are, apart from `VatValidationProvider` gaining `'gus_pl'` (R-13). The existing
`MinisterstwoFinansowClient` and `ViesClient` each gain one public method returning the parsed
registry response (`search(nip)` / `check(country, number)`); their `validate()` is rewritten over
that method, unchanged in behaviour, and the new MF and VIES registry adapters call it too — one
HTTP implementation and one throttle per registry.

**Rationale.** `VatValidationResult` answers *"is this VAT ID valid"* and is a published port
contract consumed by `customers` (`vatValidatorPort`). The lookup answers *"what does the registry
know about this company"* — a structured address, REGON, VAT **and** activity status — which the
first question does not need. Stretching it would change a cross-module contract for a need only
`organizations` has, and its `outcome` already conflates "not an active VAT payer" with "failed".
The type stays internal (not in `contracts`) because nothing outside the module consumes it
(Principle IV); the HTTP contract the storefront sees is in `contracts` (R-15).

**Rejected.** Adding `street`/`postalCode`/`city` to `VatReturnedAddress` and a `vatStatus` to
`VatValidationResult` — widens a port for one consumer and still cannot say "found by GUS, VAT
status from the White List". A second copy of the MF/VIES HTTP code inside `registry-lookup/` — two
throttles against one per-IP limit, two places to fix the next schema drift.

---

## R-3 — Polish routing, the operator's choice of sources, and where the VAT status comes from

**Decision.** The registries that answer for a Polish NIP are an operator setting,
`organizations.registration.registry_lookup_pl_sources` (owner decision OD-5): `gus_mf` (default),
`gus` or `mf`. It is read per lookup (fail-closed to the default: an unreadable or unknown value is
`gus_mf`). Non-Polish EU VAT numbers always go to VIES, whatever the setting. A registry the
setting excludes is not called, consumes no budget (R-7), and is recorded in `attempts` as
`{ outcome: 'skipped', errorKind: 'excluded_by_setting' }`, so a moderator can tell "not asked"
from "failed".

**`gus_mf` (default)** — GUS and the White List **in parallel** (`Promise.allSettled`, each with
its own timeout), GUS only when a GUS credential resolves:

| GUS | White List | Result |
| --- | --- | --- |
| found | found | **found** — name, address, REGON, activity from GUS; VAT status from WL |
| found | not found | **found** — GUS data; VAT status `not_registered` |
| found | unavailable | **found** — GUS data; VAT status `unknown` |
| not found / unavailable / not configured / over budget | found | **found** — WL name, WL address parsed (R-6), WL VAT status; REGON from WL when present; activity `unknown` |
| not found | not found | **not_found** |
| unavailable / not configured / over budget | not found | **not_found** (the only registry consulted said so) |
| not found | unavailable | **not_found** with VAT status unknown (GUS is authoritative for existence) |
| unavailable / not configured / over budget | unavailable | **unavailable** |

**`gus`** — GUS alone; the White List is never called by the registration lookup:

| GUS | Result |
| --- | --- |
| found | **found** — GUS data; VAT status `unknown` (not checked); `vatStatusSource: null` |
| not found | **not_found** |
| unavailable / not configured / over budget | **unavailable** — no White List fallback |

**`mf`** — the White List alone; GUS is never called, even when a credential is configured:

| White List | Result |
| --- | --- |
| found | **found** — WL name, WL address parsed (R-6), WL VAT status; REGON when present; activity `unknown` |
| not found | **not_found** |
| unavailable / over budget | **unavailable** |

Every leg's `{ provider, outcome, errorKind, durationMs }` is kept as the lookup's `attempts`; the
mode in force is kept beside them as `plSources` (data-model §1.1, §3).

**Rationale.** The owner wants the VAT status shown, and GUS does not have it; the White List is the
authoritative public source of Polish VAT registration. In `gus_mf` it is also the GUS fallback
(OD-1), so it is consulted on every Polish lookup anyway — asking it in parallel costs no extra
registry call in the fallback case and keeps latency at max(GUS, WL) instead of their sum. GUS
stays primary for name and address because its address is structured and its name is the REGON
register's. The other two modes exist because the two registries' costs differ by deployment:
`gus` spends nothing of the White List's per-IP **daily** quota, which the administrator's
"Validate now" also draws on, at the price of no VAT status and no fallback; `mf` needs no GUS key
at the price of a best-effort address.

**Rejected.** *Sequential GUS → WL only on failure*: no VAT status on the success path, which is
the common one. *GUS → then WL for status*: the same two calls, summed latency. *A fourth mode
"GUS, White List only as fallback"*: not asked for; `gus_mf` already falls back, and the quota
saving it would buy is what `gus` is for. *Deriving the mode from whether a GUS credential exists*:
cannot express "I have a key but want to keep the White List quota" or "I have a key but want the
VAT status from one call" — the owner made it an explicit choice. ***VIES for Polish VAT status, in
any mode*: VIES answers whether a number is registered for intra-Community (VAT-UE) transactions,
not whether the company is an active domestic VAT payer — a Polish "czynny" payer need not be
VIES-registered, and a VIES registration says nothing about "zwolniony" status — so using it would
report the wrong fact under the right label.**

---

## R-4 — GUS BIR1.1: protocol facts the client is built on (verified in T001, 2026-11-05)

**T001 findings (test environment, test key).** Confirmed as written below: both endpoints and the
test key, the namespaces, the three action URIs, the `sid` HTTP header, a 20-character
`ZalogujResult`, an **empty** `ZalogujResult` for a refused key, MTOM framing (`multipart/related;
type="application/xop+xml"`, envelope prefix `s:`), the result as escaped XML, `KodPocztowy`
already formatted `NN-NNN`. Corrections and additions:

- **Not found** comes back *inside* `<dane>`: `ErrorCode` `4`, `ErrorMessagePl`, `ErrorMessageEn`,
  `Nip` — the search result is not empty, and `GetValue(KomunikatKod)` afterwards also answers `4`.
- **Stale or invalid sid** gives an **empty** `DaneSzukajPodmiotyResult`; `GetValue(KomunikatKod)`
  then answers **empty** (not `7`), and `GetValue(StatusSesji)` answers `0` (`1` with a live sid).
  The client therefore treats "empty result" as the session signal and confirms it with
  `StatusSesji`, not `KomunikatKod`.
- The escaped payload contains `&#xD;` (CR) between leaves; entity decoding must handle numeric
  references, and leaf values are trimmed.
- `Ulica` carries the street-type prefix (`ul.`, `al.`, …) as GUS stores it; `street` keeps it.
- Test-environment data is anonymised (e.g. `Ulica` `ul. Test-Krucza`); fixtures copy the framing,
  never the data.
- Latency in the test environment: 20–90 ms per call.
- **TLS.** `curl` on macOS refuses the chain of both GUS hosts and of the VIES host
  ("self signed certificate in certificate chain" / "unable to get local issuer certificate"),
  while Node 22's bundled CA store accepts all three. The client relies on Node's default store; a
  deployment that replaces it (`--use-openssl-ca`, a custom `NODE_EXTRA_CA_CERTS` corporate bundle
  is fine) must verify these hosts. Recorded in the module documentation (T055).
- **Not exercised** (no suitable test NIP found): a sole trader (`Typ` `F`), several units, a
  ceased unit, the 60-minute session expiry. The fixtures for these cases follow the documented
  shape and remain to be confirmed against production after release.

**Service.** SOAP 1.2 with WS-Addressing.

| | Production | Test |
| --- | --- | --- |
| Endpoint | `https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc` | `https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc` |
| Key | issued by GUS on request, per user | public test key `abcde12345abcde12345` |

**Operations used.** Namespaces `ns = http://CIS/BIR/PUBL/2014/07`,
`dat = http://CIS/BIR/PUBL/2014/07/DataContract`; request `Content-Type:
application/soap+xml; charset=utf-8`; each envelope carries `wsa:To` (the endpoint) and
`wsa:Action`:

1. **`Zaloguj(pKluczUzytkownika)`** — action `http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Zaloguj`.
   Returns the session id (`ZalogujResult`, 20 characters); an **empty** result means the key was
   refused.
2. **`DaneSzukajPodmioty(pParametryWyszukiwania: { Nip })`** — action
   `…/IUslugaBIRzewnPubl/DaneSzukajPodmioty`, sent with HTTP header **`sid: <session id>`**.
   `DaneSzukajPodmiotyResult` is an **XML document escaped as text** (`&lt;root&gt;&lt;dane&gt;…`),
   one `<dane>` per registry unit, with flat leaves: `Regon`, `Nip`, `StatusNip`, `Nazwa`,
   `Wojewodztwo`, `Powiat`, `Gmina`, `Miejscowosc`, `KodPocztowy`, `Ulica`, `NrNieruchomosci`,
   `NrLokalu`, `Typ` (`P` legal person / `F` natural person / `LP`, `LF` local units), `SilosID`,
   `DataZakonczeniaDzialalnosci`, `MiejscowoscPoczty`.
3. **`GetValue(pNazwaParametru)`** — namespace `http://CIS/BIR/2014/07`, action
   `http://CIS/BIR/2014/07/IUslugaBIR/GetValue`; read only when a search result is empty, with
   `KomunikatKod` (`4` no data, `7` no or expired session, `2` too many identifiers, `5` not
   authorised) and, on a suspected stale session, `StatusSesji` (`1` active, `0` not). T001: a
   stale sid answers an **empty** `KomunikatKod`, so `StatusSesji` is the session signal.
   A BIR1.1 search may instead return the error **inside** `<dane>` as `ErrorCode` /
   `ErrorMessageEn`; both spellings map to the same outcomes.

**Responses are MTOM** (`multipart/related; type="application/xop+xml"`): the SOAP envelope sits
between MIME boundaries. The client takes the substring from the first `<s:Envelope` (any prefix)
to its matching close tag, whatever the outer framing — the established way hand-written BIR
clients read it.

**Session.** A session id stays valid for 60 minutes of inactivity. `Wyloguj` exists and is not
called (R-9).

**Decision — one call per lookup, no full report.** `DaneSzukajPodmioty` already carries the name
and the whole postal address. `DanePobierzPelnyRaport` would add a second round trip and a report
name per entity type (`BIR11OsPrawna`, `BIR11OsFizycznaDzialalnoscCeidg`, …) for fields the
registration form does not have (PKD codes, registration dates).

**Decision — address composition.**
- `street` = `Ulica` + `' '` + `NrNieruchomosci` + (`'/'` + `NrLokalu` when present). When `Ulica`
  is empty (villages without street names), `street` = `Miejscowosc` + `' '` + `NrNieruchomosci`
  (+ unit) and `city` = `MiejscowoscPoczty`; otherwise `city` = `Miejscowosc`.
- `postalCode` = `KodPocztowy` (T001: already `NN-NNN`); a bare `NNNNN` is still normalised to `NN-NNN`.
- `country` = `PL`; `regon` = `Regon`; `activityStatus` = `ceased` when
  `DataZakonczeniaDzialalnosci` is non-empty, else `active`.
- Several `<dane>`: prefer `Typ` `P`/`F` over local units, then a unit with no end date, then
  registry order.

**Rejected.** WSDL-driven SOAP libraries (`soap` on npm) — a runtime dependency that fetches and
interprets a WSDL to send three fixed envelopes. SOAP 1.1 — BIR1.1 is a SOAP 1.2 service.

---

## R-5 — XML handling without a new dependency

**Decision.** Hand-built envelopes (template strings, the key XML-escaped; the NIP is ten digits
after normalisation and needs no escaping) and a **minimal extractor** in
`integrations/gus-bir-soap.ts`:

1. refuse a body over 256 KB, or containing `<!DOCTYPE` or `<!ENTITY`, as `invalid_response`;
2. cut the SOAP envelope out of the MTOM body (R-4);
3. read the one result element by name, decode the five predefined entities and numeric character
   references, giving the inner document;
4. split the inner document on `<dane>…</dane>` and read the known leaf names with
   `<Name>([^<]*)</Name>` or `<Name/>`, decoding entities in each value.

**Rationale.** The documents come from a fixed host, have a fixed flat schema, and the client reads
fewer than twenty leaf names. Nothing in `organizations` parses XML today. `fast-xml-parser` is in
`backend/package.json` (added in `7e63f9c2d` for a carrier module that is not in this tree) and is
imported by no source file here; adding it to the `organizations` package's own manifest would be a
new runtime dependency of that package (Principle IV), to replace about sixty lines that a fixture
suite covers completely. Refusing DTDs makes entity-expansion attacks impossible by construction.

**Rejected.** `fast-xml-parser` in `organizations/package.json` — see above; reconsider only if a
second registry with nested XML arrives. A general regex over the whole document — the inner
document is escaped inside the outer one, so one pass cannot read both.

---

## R-6 — White List and VIES: reuse, and parsing a one-line address (verified in T001, 2026-11-05)

**White List.** `GET {base}/api/search/nip/{nip}?date=YYYY-MM-DD`, existing client.
`statusVat` maps `Czynny` → `active`, `Zwolniony` → `exempt`; a `null` subject → `not_found` (VAT
status `not_registered` when GUS found the company).

**T001 findings.**
- **The host moves.** gov.pl (<https://www.gov.pl/web/kas/api-wykazu-podatnikow-vat>): the service
  is redirected to `https://wykazpodatnikowvat.mf.gov.pl/api/` since 15.10.2026, and
  "Dotychczasowy adres usługi https://wl-api.mf.gov.pl będzie obsługiwany do dnia 1.12.2026 r."
  The new host answers the same paths with the same bodies (checked: found, null subject,
  `400 WL-115` for a bad checksum). The existing client's default `baseUrl` is the old host, which
  breaks the **already-shipped** admin "Validate now" on 2026-12-01 — independent of this feature;
  T001a fixes it in its own merge request, ahead of this feature.
- An unknown NIP answers **`200` with `subject: null`**, not `404` (the existing client already maps
  a null subject to `not_found`); a NIP failing the checksum answers `400` `{"code":"WL-115"}`.
- **Limits** (gov.pl, quoted): "Przy wykorzystaniu metody „search” możesz złożyć 100 zapytań
  dziennie o maksymalnie 30 podmiotów jednocześnie"; "Po wyczerpaniu jednego z limitów dostęp do
  API może być zablokowany do godziny 0:00." The limit is per source IP (inferred from error
  `WL-1919`, "Limit … dla tego adresu IP … wyczerpany"); the reset time zone is not stated —
  Europe/Warsaw is assumed. The block covers search, check and the web search page for that IP.
- **Over-limit shape is undocumented**: the Swagger lists only `200` and `400`; responses carry no
  rate-limit headers. The client therefore maps a body `code` of `WL-1919` (any status) and `429`
  to `unavailable` / `rate_limited`, and `WL-1188` ("database update in progress") to
  `unavailable` / `provider_maintenance`, rather than to `failed`.

That daily limit is shared with the admin "Validate now" flow (and, since it is per IP, with
anything else the deployment's egress address queries), which is why the daily budget (R-7) keeps
the registration lookup well below it.

**White List address parsing** (`registry-lookup/address-parsers.ts`). The White List writes
`workingAddress` (preferred) or `residenceAddress` as `"<street part>, <NN-NNN> <CITY>"`, upper case.
Split at the **last** `", "`; the right part must match `^(\d{2}-\d{3})\s+(.+)$` to give postal
code and city; the left part is the street. No comma, or a right part that does not match → the
whole string is the street and postal code and city stay empty for the buyer. The case is kept as
the registry wrote it (title-casing Polish names is wrong often enough to be worse than upper case
in an editable field).

**VIES.** Existing REST client. T001: a German number answers `valid: true` with `name` and
`address` both `"---"` (Germany does not disclose them), so a German lookup yields VAT status only
and no prefill; Polish numbers answer name and a two-line address (`"<street>\n<NN-NNN> <CITY>"`),
the name sometimes shorter than GUS's (`ORLEN SPÓŁKA AKCYJNA` vs the full registered name). `valid: false` → `not_found`; `valid: true` → found, VAT status
`active`, activity `unknown`. `name` / `address` of `---` or empty → `null`. Address parsing: split
on line breaks; when the last line matches `^(\S*\d\S*)\s+(.+)$`, it gives postal code and city and
the earlier lines, joined with `", "`, give the street; otherwise everything is the street.

**Rejected.** Using the White List `check` endpoint — it verifies a NIP **and a bank account**,
which the registrant has not given. Per-country VIES address grammars — 26 formats for a field the
buyer can correct; the generic rule and an empty field beat an invented one (FR-005).

---

## R-7 — Abuse protection: the lookup must not be an open proxy

**Decision.** Seven layers, cheapest first:

1. **Normalisation and checksum** (R-17) before anything else — an invalid NIP or unsupported
   country contacts nothing.
2. **Per-client rate limit** on the route: `config.rateLimit = { max: 10, timeWindow: '10 minutes',
   keyGenerator: (r) => \`org-registry-lookup:${r.ip}\` }` — the `cms` contact-form precedent
   (`packages/modules/cms/src/backend/routes.storefront.ts`, `CMS_CONTACT_FORM_RATE_LIMIT`). The
   storefront calls the backend from its own server, so it forwards the browser's
   `x-forwarded-for` exactly as `storefront/lib/api/forms.ts` does, and the deployment's
   `TRUSTED_PROXY_HOPS` / `TRUSTED_PROXY_ADDRESSES` (`packages/platform/src/http/trusted-proxy.ts`)
   decide whether `request.ip` believes it. The limiter is per process; layer 4 is the shared one.
3. **Cache** (R-8) — a hit contacts nothing and consumes no budget.
4. **Platform-wide budget per registry**, in Redis (`INCR` + `EXPIRE` on a key per provider per
   window), checked before each outbound call: GUS 300 and VIES 300 per UTC hour; the White List
   **60 per Europe/Warsaw calendar day**, because its documented limit is daily (R-6) and the
   admin "Validate now" flow must keep the rest (constants in `registry-lookup/limits.ts`,
   re-measured in T001). Over budget → that leg is `unavailable` / `budget_exhausted`; under
   `gus_mf` with GUS configured, GUS still answers and only the VAT status becomes `unknown`.
   **A registry the Polish-sources setting excludes is never called and consumes none of its
   budget**: under `gus` the registration lookup spends **no** White List budget at all, leaving
   the whole daily quota to "Validate now"; under `mf` it spends no GUS budget. The budget is
   checked only for the legs the mode runs.
   However many addresses an attacker rotates through, the most they can spend is the budget,
   after which buyers type their data by hand — never the registry quota and never the admin's
   White List allowance.
5. **Timeouts**: GUS 4 s per request with a 6 s ceiling for login + search; White List and VIES 5 s
   (existing); the whole lookup ≤ 8 s (FR-007).
6. **Fixed upstreams, fixed answer**: the three endpoint URLs are constants (GUS's chosen by the
   credential's `environment` select, never a URL); only the normalised tax ID leaves the
   platform; the response carries only the fields of the contract (R-15) and never says whether
   the tax ID is registered on this platform.
7. **Fail closed**: a Redis error on the cache, budget or ticket store answers `unavailable` — the
   lookup never runs unmetered.

**Rationale.** The quota at risk is the registries' (and, for the White List, shared with the
admin flow), so the decisive control is the shared budget, not the per-IP limit; the per-IP limit
keeps one client from monopolising the budget and is free. Constants rather than settings: nobody
has asked to tune them, and an overlay can replace the module's limits file (Principle XV) if one
ever must.

**Rejected.** *CAPTCHA* — friction on every B2B registration and a provider dependency; the
`forms` module's CAPTCHA integration is that module's and not a published seam. Reconsider if the
budget is measurably exhausted by abuse. *A Redis-backed per-IP counter* — a second per-IP limit
duplicating layer 2 across processes; the budget already bounds the total. *Settings for the
limits* — YAGNI.

---

## R-8 — Redis: answer cache and lookup tickets

**Decision.** Two key families on the composition's `redis` connection (already in the
`organizations` cradle for the role cache, typed structurally — `get`, `set … EX`, `del`, `incr`,
`expire`):

| Key | Value | TTL |
| --- | --- | --- |
| `b2b:org-registry-lookup:v1:answer:<CC>:<sources>:<taxId>` | the merged lookup (R-3), JSON; `<sources>` is the Polish-sources mode for `PL` and `vies` for every other country, so changing the mode never serves an answer fetched under another | found 6 h; not found 30 min; unavailable 60 s |
| `b2b:org-registry-lookup:v1:ticket:<lookupId>` | `RegistryLookupSnapshot` (data-model §3), JSON | 2 h |
| `b2b:org-registry-lookup:v1:budget:<provider>:<window>` | counter; `<window>` is `yyyymmddhh` (UTC) for GUS and VIES, `yyyymmdd` (Europe/Warsaw) for the White List | the window + 1 h |

Every lookup that consulted, or tried to consult, a registry (outcomes found, not found,
unavailable) **mints a new ticket** — 32 random bytes, base64url (43 characters) — holding the
answer it was given, cached or not. Registration reads the ticket, uses it if it matches (R-13),
and deletes it after the registration commits; a refused registration leaves it for the retry.

**Invalidation.** None beyond TTL, deliberately: no write on this platform changes a registry's
answer, and both readers of the store (the lookup endpoint, registration) check the toggle before
reading, so switching the lookup off needs no flush. This is the one Redis use in the feature that
is *not* a domain cache, which is why the lifecycle pub/sub drop pattern
(`organization-role-cache.ts`, `ORGANIZATION_ROLES_CHANGED_CHANNEL`) does not apply; the
storefront-facing toggle cache **is** invalidated on change (R-11).

**Rationale.** A ticket is short-lived, unaudited until registration, and must be shared by every
API process; Redis is already the platform's store for exactly that. The ticket's purpose is
provenance: the snapshot registration persists is the one the platform fetched and the buyer was
shown, by construction, not data the browser sent back (FR-019).

**Rejected.** *A database table for tickets* — writes on an anonymous endpoint, a sweeper, and an
org-less tenant-classified row (Principle XI) for something that lives two hours. *Signed
client-side tokens carrying the snapshot* (HMAC) — workable, but the platform would still have to
trust and verify a blob the browser carried, and a new signing secret is a new environment input.
*Trusting the answer cache by tax ID at registration, with no ticket* — the cache entry may have
expired or changed since the buyer saw it; it cannot say what the buyer was shown.

---

## R-9 — GUS session management

**Decision.** One session per API process, in memory: `{ sid, keyFingerprint, lastUsedAt }`. A
lookup reuses the session while it was used less than 50 minutes ago **and** the fingerprint
(SHA-256 of the resolved key and environment) is unchanged; otherwise it logs in first.
Concurrent lookups share one in-flight login (single-flight). A search answering "no or expired
session" (an empty result with `StatusSesji` 0 — T001 —, or `KomunikatKod` 7) clears the session, logs in
once more and retries once. An empty `ZalogujResult` → `gus_invalid_key`, logged at `warn` once
per fingerprint per hour, and the White List answers (OD-1). The sid is never logged.

**Rationale.** GUS sessions are cheap but not free (a call against the same quota); one per process
per hour is negligible. The fingerprint makes a rotated key or a switched environment take effect
on the next lookup with no invalidation message.

**Rejected.** *A session shared in Redis* — saves one login per process per hour and puts
key-derived state in a shared store. *Logging in per lookup* — doubles GUS calls. *Calling
`Wyloguj`* — the session expires on its own; logging out on shutdown adds a shutdown hook for
nothing.

---

## R-10 — Storefront: one client form, React action state, no form data in the URL

**Decision.** The registration page stays a Server Component that reads the server context and the
registration options (R-11) and renders a new client component, `RegisterForm`
(`storefront/components/auth/RegisterForm.tsx`), bound to **one** server action,
`registerFormAction(prevState, formData)` (`storefront/app/(auth)/register/actions.ts`), through
`useActionState`. The action dispatches on the submitter's `intent`:

- `intent=lookup` → call the lookup (forwarding `x-forwarded-for`), return state
  `{ values (everything typed, **never the password**), lookup: { status, lookupId, company,
  source } }`; when found, `values`' company fields are replaced by the registry's.
- `intent=register` (the default) → call register with `registryLookupId` from a hidden field;
  success redirects to `?status=pending` as today; a refusal returns `{ values, lookup, error }`
  instead of the current `?error=` redirect.

**Without JavaScript**, Next.js runs the action on the form POST and renders the page with the
returned state (React 19 progressive enhancement of `useActionState`), so the form comes back
prefilled with nothing in the URL — the owner's PR #715 ruling and `RoleEditorForm`'s
(`storefront/components/account/RoleEditorForm.tsx`) shape.
**With JavaScript**, the "Fetch company data" button does not submit the form: it calls a second
server action, `lookupCompanyAction({ taxId, country })`, inside a transition, and writes the answer
into the company fields, which are controlled inputs seeded from the action state. Registration
submits through `onSubmit` + `startTransition`, as `RoleEditorForm` does, so React does not reset
the fields after a refusal.

**Field order.** One order whether the lookup is on or off: country, tax ID (+ button when on),
company name, street, postal code, city; then the owner fieldset unchanged. Country moves up
because the lookup needs it; one order means one layout to test.

**Enter key.** The HTML default button of a form is its first submit button in tree order, which
here is "Fetch company data". With JavaScript, `onSubmit` reads `event.nativeEvent.submitter` and
the focused element: Enter in the tax ID field fetches, Enter anywhere else registers. Without
JavaScript, Enter in a field below the tax ID fetches instead of registering; the page returns with
every value but the password kept. **Accepted limitation**, recorded for the designer review
(T060): the alternatives — a visually hidden default "register" button first in the form, or a
two-step form — each cost every buyer something to spare the rare no-JS buyer one retyped password.

**Revised by the designer review (T060, 2026-11-05): a hidden default button.** When the lookup is
on, the form's first submit button is a visually hidden `intent=register` button with
`tabIndex=-1` and `aria-hidden="true"`, so an Enter in any field registers, with or without
JavaScript (Jakob's Law: Enter submits the form's primary action). It is outside the tab order and
the accessibility tree, so it costs a sighted, keyboard or screen-reader buyer nothing — the cost
the original decision feared does not materialise. It also removes the pointer/key intent
bookkeeping on the JavaScript path: the lookup button is the submitter only when it is itself
activated. Remaining no-JS difference: an Enter *in the tax ID field* registers (the browser's
validation then points at the first empty field); the visible button still fetches.

**Rejected.** *A cookie stash* (`specs/170-forms-module/` R-10) — needed there because a Page
Builder block posts to a route handler and cannot hold action state; this page owns its form.
*Query-string prefill* — personal data in URLs and history, and a crafted link could prefill a
registration (PR #715). *The browser calling the backend directly* — cross-origin, loses the
no-JS path, and the backend would see no forwarded address. *Lookup on blur* — a request per
keystroke-and-leave, against a rate-limited, budgeted endpoint; an explicit button (plus Enter) is
predictable and announces its outcome once.

---

## R-11 — How the storefront learns the toggle

**Decision.** `GET /api/v1/organizations/registration-options` (anonymous, `salesChannelAccess:
'open'`) answers `{ data: { registryLookup: { enabled, countries } } }`. The storefront reads it
with `revalidate: 300` and the Next tag `organizations:registration-options`, and **fails closed**
(any error → disabled, the manual form) — the `getFederatedSignInProviders` precedent
(`storefront/lib/api/federated-sign-in.ts`). `organizations` subscribes to `settings.value_changed`
through `ctx.subscribe` and, for its two registration setting codes, calls
`StorefrontRevalidator.revalidate(['organizations:registration-options'])` — the
`google_tag_manager` precedent (`packages/modules/google_tag_manager/src/backend/index.ts`).
`countries` is the supported set (PL + the VIES member states), so a headless client need not
hard-code it; the same constant is exported from `contracts`.

**The Polish-sources mode is not exposed** in this answer, and `countries` keeps `PL` whatever the
mode. The storefront needs nothing from it: the lookup answer already names its `source`, and the
VAT-status line renders from `vatStatus` (`unknown` reads "VAT status not checked" — the storefront
words `unknown` the same way whether it came from a mode or an outage). Dropping `PL` from
`countries` under `gus` with no credential was considered and rejected: the owner specified
`unavailable` for that case, and a derived `countries` would make the button disappear for Polish
buyers on a configuration slip with nothing telling the operator — the Settings-screen warning
(R-12) is where that slip is caught. The tag is therefore not revalidated on a change of mode.

**Rationale.** Channel-independent, as OD-2 requires; the revalidation makes the switch immediate,
the TTL bounds a lost revalidation to five minutes (spec US3 scenario 2). Failing closed costs a
buyer nothing they cannot already do — the manual form.

**Rejected.** *Module presence* (`/api/v1/storefront/module-presence`) — this is a setting of an
always-present module, not presence. *A generic public settings endpoint* — none exists, and one
would publish settings by accident. *Probing the lookup endpoint for 404* — a budgeted call to learn
a boolean.

---

## R-12 — The GUS credential and the three settings

**Decision.**

- A configuration type **`organizations_gus_bir`**, `ownerModule: 'organizations'`, provider
  `bir11`, fields `apiKey` (string, required, **secret**) and `environment` (select
  `production` / `test`, required, `endpoint: true` so that changing it asks for the key again, as
  the SMTP host does in `email-adapter.type.ts`). Declared in
  `registry-lookup/gus-credential.type.ts`, pushed into `configurationTypeRegistry` from a
  **contribution** boot hook — unprobed, the `product_feeds` shape
  (`delivery-credential.type.ts`, `index.ts` `ctx.onBoot`); `organizations` is non-deactivatable
  anyway.
- Settings, platform-wide, group `organizations`:
  `organizations.registration.registry_lookup_enabled` (boolean, default `false`, spec OD-6), `organizations.registration.gus_credentials` (`credential_ref`, `configurationType:
  'organizations_gus_bir'`, default `''`) and `organizations.registration.registry_lookup_pl_sources`
  (`string`, `enumOptions: ['gus_mf', 'gus', 'mf']`, default `'gus_mf'`, OD-5; the Settings screen
  renders `enumOptions` as a choice, the `newsletter` opt-in-mode precedent).
- **Warning for `gus` without a GUS credential.** The description says it in words. The Settings
  screen also offers the `settings.setting.after` admin zone (`SettingRowEditor.tsx`), through which
  a module shows "a preview of what the value amounts to, a consequence, a warning" beside one of
  its settings (`seo`'s robots/llms previews are the precedent). `organizations` contributes
  `PlSourcesWarning` to it: rendered only for the sources setting, it shows an `Alert` (warning,
  icon + text) when the draft value is `gus` and the stored
  `organizations.registration.gus_credentials` is empty, read through the settings admin API the
  screen already uses. It checks emptiness only — whether the referenced credential *resolves*
  (exists, decrypts, `credentials` on) is not knowable on that screen without a new endpoint, so
  the description covers that remainder. The zone hands back nothing, so it cannot block a save
  (the zone's own contract).
- Resolution per lookup, only when the mode includes GUS: read the reference; if empty → no GUS; else, only if
  `effectiveState.isPresent('credentials')`, `lazyPort<CredentialsPort>(ctx,
  'credentialsService').resolve(code)`; `status !== 'ok'` → no GUS. The `cms` translation
  precedent (`packages/modules/cms/src/backend/index.ts`, `translationConfig`).
- Manifest `nonBindingDependencies`: `credentials` / `configurationTypeRegistry` /
  `contributes-to`, and `credentials` / `credentialsService` / `degrades-without` ("Polish lookups
  use the White List alone").

**Rationale.** OD-1 puts the key in `credentials`, which gives AES-256-GCM at rest, masking and
"never returned in full" with no crypto here. A hard dependency is impossible in spirit:
`organizations` is the tenancy root (its manifest's Rule 3 comment) and is non-deactivatable, so
`credentials` in its `dependencies` would make `credentials.enabled` a dead switch — the exact
reasoning `cms` records for the same edge.

**Rejected.** *A `secret` setting* (`assets_library`, `forms`) — OD-1 names `credentials`; a
setting secret is not reusable by an admin-validation follow-up. *The `llm`-style shared type
owned by `credentials`* — the GUS key has meaning only to `organizations` (Principle XIV: the
consumer owns provider meaning). *An environment URL field* — would let an operator point the
client anywhere (R-7 layer 6).

---

## R-13 — Persisting the lookup at registration

**Decision.**

- `registerOrganizationRequestSchema` gains an optional **top-level** `registryLookupId` — not
  inside `organization`, because `AdminOrganizationCreateBodySchema` is derived from
  `registerOrganizationRequestSchema.shape.organization` and the admin create must not accept it.
- `RegistrationService.registerOrganization` gains a `registryLookup` collaborator. After the
  Organization row, on the same `EntityManager` and transaction: if the toggle is on and the
  ticket exists and its normalised tax ID and country equal the submission's (normalised with the
  same function), write **one** `OrganizationTaxIdValidation` row (data-model §1) with
  `origin: 'registration'`, the snapshot, the attempts and the submitted values, inside
  `withOrgScope(organization.id, 'organizations: registration persists the registry lookup of the
  Organization it creates')`; and stamp `vatValidatedAt`, `vatValidationProvider`,
  `vatValidationOutcome` on the Organization. Anything else → nothing written, an `info` log.
- After the commit, the ticket is deleted (best effort; it expires anyway).
- **Outcome mapping** to the existing `VatValidationOutcome`:

  | Lookup | VAT status | `outcome` | `errorKind` |
  | --- | --- | --- | --- |
  | found | active | `validated` | — |
  | found | exempt / not registered | `failed` | `not_active_vat_payer` (the MF client's existing code) |
  | found | unknown, because the White List leg failed or was over budget (`gus_mf`) | `deferred` | `vat_status_unavailable` |
  | found | unknown, because the mode is `gus` (not checked by design) | `unverified` | `vat_status_not_checked` |
  | not found | — | `failed` | `not_found` |
  | unavailable | — | `deferred` | the first leg's error kind |

  `provider` is the leg that supplied the data (`gus_pl`, `mf_pl`, `vies`), else the first leg
  tried that was not excluded by the mode; `VatValidationProvider` gains `'gus_pl'` (in `contracts` and the entity type). Widening
  the union is safe: outside `organizations` the type is named only by two test fixtures that set
  it to `null` (`search` and `pwa` `cross-module-ports.test.ts`).
- **Audit**: no new audit call. The row is part of the registration unit; the existing
  `organization.register` entry's `stateAfter` gains `registryLookup: { provider, outcome }`
  (Principle XIII, Constitution Check).

The `gus`-mode row is `unverified` rather than `deferred` because nothing is pending: the VAT
status was deliberately not asked for, and `deferred` tells an administrator to retry. "Validate
now" (White List) remains the way to check it.

**Rationale.** One row per lookup keeps the panel's existing rule — one row per attempt — and the
attempts array keeps the per-registry detail without a second row the panel would have to pair.
The same transaction means a refused registration leaves no orphan row. `withOrgScope` is the
narrowest sanctioned hatch: the actor is anonymous and the only tenant is the one being created
(`predefinedRoleIdOn` in `organization-role-store.ts` faces the same situation with
`withSystemScope`; the narrower hatch is preferable for a write).

**Rejected.** *Two rows (GUS + White List)* — the panel's "latest row" summary and auto-fill
button would read the White List row and ignore the GUS data. *Client-sent registry values* —
FR-019. *A lookup at registration when no ticket came* — registration would contact registries and
slow down (FR-021); the admin's "Validate now" covers it. *A Command for the row* — the row is not a
separate operation; splitting the registration into two audited units is the inconsistency
Principle XIII forbids.

---

## R-14 — Divergence: computed on read, by one pure function

**Decision.** `registry-lookup/registry-divergence.ts` exports
`computeRegistryDivergence(registry, submitted)` → `{ field, registry, submitted }[]` over `name`,
`street`, `postalCode`, `city`, `country`. Two values are equal when their **comparison forms** are:
Unicode NFC, `foldDiacritics` (from `contracts`), lower case, punctuation (`. , " ' „ ” -`) removed,
whitespace collapsed, a leading `ul` / `al` / `pl` / `os` street prefix removed, postal codes reduced
to digits, and Polish legal forms reduced to one token (`spółka z ograniczoną odpowiedzialnością` ≡
`sp z o o`, `spółka akcyjna` ≡ `sa`, `spółka komandytowa` ≡ `sp k`, `spółka jawna` ≡ `sp j`,
`spółka komandytowo-akcyjna` ≡ `ska`, `prosta spółka akcyjna` ≡ `psa`). A field the registry left
empty is never a divergence. The admin API returns the list with each registration-origin row.

**Rationale.** Persisting the list would freeze today's comparison rules into history; computing it
on read from the two persisted snapshots lets the rules improve. Computing it in the backend gives
the admin panel and any headless admin the same answer.

**Rejected.** *Comparison with the Organization's current fields* — an administrator's later edit
would read as a customer's divergence. *Exact comparison* — the White List writes upper case, so
every Polish registration would "differ".

---

## R-15 — Endpoint shapes

**Decision.** `POST /api/v1/organizations/registry-lookup` (contract in
`contracts/public-api.md`). `200` for every business outcome, including `invalid_tax_id` and
`unsupported_country`; `400 VALIDATION_ERROR` for a malformed body; `404` — byte-identical to the
platform's answer for an unknown route — while the toggle is off; `429 RATE_LIMITED` over the
per-client limit. `Cache-Control: no-store`. No new error code.

**Rationale.** POST because the call mints server state (a ticket) and because a tax ID in a URL
lands in access logs and intermediary caches. Outcomes are answers, not failures, so a client
renders them from one shape. A 404 identical to an unregistered path is what "behaves as absent"
means (OD-2).

**Rejected.** *GET with the tax ID in the query.* *`404` for "not found"* — indistinguishable from
the disabled state, which a client must treat differently. *A dedicated `REGISTRY_LOOKUP_DISABLED`
code* — would document the feature's existence while it is off.

---

## R-16 — Off-state: a feature setting of a non-deactivatable module

**Decision.** The two routes are registered with the module's others through `ctx.routes`; the
lookup handler reads the toggle per request (through the module's `readSetting`) and answers the
unknown-route 404 when off. `registration-options` always answers (it is what says "off"). The
registration ignores tickets when off. Off-state tests cover the endpoint, the options, the
registration and the storefront (US3).

**Rationale.** `specs/conventions/module-activation.md` governs *module* presence; `organizations`
declares `activation.nonDeactivatable`, so that axis never closes here. A feature switch inside an
always-present module is a setting read per request (the `cms` translation and `google_tag_manager`
precedents).

**Rejected.** *Registering the route conditionally at boot* — a toggle change would need a restart
(FR-025).

---

## R-17 — Tax-ID normalisation and the NIP checksum

**Decision.** `registry-lookup/tax-id.ts`, pure, shared by the lookup and the ticket check:

1. Strip whitespace, `-` and `.`; upper-case.
2. If it starts with two letters that are a supported country code (`EL` for Greece and `XI` for
   Northern Ireland included, `GR` mapped to `EL`), they are the country and the rest is the
   number; else the chosen country applies.
3. Country `PL`: the number must be ten digits whose checksum holds — weights 6, 5, 7, 2, 3, 4, 5,
   6, 7 over the first nine, sum mod 11 equal to the tenth digit, mod 11 of 10 invalid.
4. Other supported country: `^[0-9A-Z+*]{2,12}$` (VIES's own syntax check decides the rest).
5. Country outside the supported set → `unsupported_country`.

**Rationale.** One function means the ticket comparison and the outbound call can never normalise
differently. The registration's stored `taxId` is not touched (spec Assumptions).

**Rejected.** *Per-country VAT syntax tables* — VIES answers `valid: false` for a malformed number
at the cost of one budgeted call; a table is 27 regexes to maintain for that.

---

## R-18 — i18n and where each string is translated

**Decision.** Storefront strings in the `auth` namespace (`storefront/lib/i18n/messages/auth.ts`,
both blocks; `defineMessages` makes a missing Polish key a `tsc` error); admin strings in the
`organizations` bundle (`packages/modules/organizations/i18n/{en,pl}.json`, flat keys), including
`settingLabels.<code>.name|description` for the three settings, the `gus`-without-credential warning and the palette action's keys. The
backend returns **codes** for outcomes, statuses and sources (machine tokens), never prose — the
storefront and the admin translate them (`specs/conventions/module-i18n.md`: a machine token is
never translated; the readers translate). Registry text (names, addresses) is third-party text,
passed through verbatim. The credential type's labels are English, as every descriptor's is today
(the credentials screen renders `typeLabel` verbatim).

**Rejected.** *Backend-composed outcome sentences* — the storefront already holds the request
language and renders the form's other copy; a code keeps headless clients free to word it.

---

## Implementation deviations (2026-11-05, `endora-commerce-dev`)

Each is the smallest change consistent with OD-1 – OD-7; none reopens an owner decision.

1. **GUS credential resolved by the service, not the client.** `contracts/gus-bir11-client.md` §1
   gave `GusBirClient` a `resolveCredential` option. T013 requires the resolver never to run under
   `mf` and the leg to be `skipped` / `not_configured` before any budget is spent, which only the
   lookup service can decide; so the service resolves it (T025) and passes `gusCredential` with the
   lookup input. The client answers `unavailable` / `not_configured` when called without one.
2. **`withSystemScope`, not `withOrgScope`, for the registration row.** Ruling D-285 keeps
   `withOrgScope` host-only (`backend/test/unit/kernel/published-surface.test.ts`: "a module uses
   `withSystemScope`"), so R-13's narrower hatch is not published to a module. The row names the
   Organization explicitly, as `predefinedRoleIdOn` does. Publishing `withOrgScope` is a ruling for
   the owner, not this feature.
3. **The migration widens `organization_tax_id_validations_provider_check`.** Data-model §1 said
   `gus_pl` needs no DDL; the consolidation migration pins the column's values with a check
   constraint, so `Migration20261105T121034OrganizationsRegistryLookupProvenance` drops and
   re-adds it with `gus_pl`. Its `down()` deletes the `origin = 'registration'` rows first.
4. **Malformed lookup body: `400 VALIDATION_FAILED`.** `contracts/public-api.md` §2 named
   `VALIDATION_ERROR`; the platform's code for a Zod refusal is `VALIDATION_FAILED`. No new code.
5. **The per-client limiter stands aside while the switch is off** (`allowList`), so an off
   endpoint never answers `429` and stays indistinguishable from an absent route (R-15, OD-2).
   The body is parsed inside the handler, after the switch, for the same reason.
6. **Two "Validate now" answers change (FR-024 characterised in T005/T006).** As R-6 states, the
   White List's `WL-1919` (daily limit) and `WL-1188` (maintenance) are `deferred`
   (`rate_limited`, `provider_maintenance`) instead of `failed` / `http_400`. And a VIES answer
   whose `userError` names an outage (`MS_UNAVAILABLE`, `MS_MAX_CONCURRENT_REQ`,
   `GLOBAL_MAX_CONCURRENT_REQ`, `SERVICE_UNAVAILABLE`, `TIMEOUT`) is `deferred` /
   `vies_<code>` instead of `failed` / `not_found` — otherwise a member-state outage would tell a
   buyer "not found" and be cached for 30 minutes. Every other `validate()` answer is pinned
   unchanged by the characterisation tests.
7. **`address_returned.countryCode` is stored in picker form** (`GR`, not `EL`), so the
   moderator's comparison with the submitted country is like for like; the divergence also treats
   `EL` ≡ `GR`.
8. **The ticket is read before the Organization row is written**, not after it (R-13): the order
   is immaterial to the result, and reading first keeps a slow Redis out of the write sequence.
9. **T057 conformance** is a standalone spec beside `locale-path.spec.ts`
   (`storefront/test/conformance/register-registry-lookup.spec.ts`): the derived page set covers
   indexable routes only, and a *found* state needs registry egress, which no CI run may open. The
   spec measures the served page and the invalid-number state, and the found state only when
   `REGISTRY_LOOKUP_FOUND_TAX_ID` is set against a deployment using GUS's test environment.
10. **A refused registration without JavaScript keeps the posted reference** even when the
    previous action state carried no lookup, so the retry still persists the snapshot (FR-017).
11. **Extra module-bundle keys** beyond `contracts/admin-surfaces.md` §9, all in EN and PL:
    `vatValidation.provider.mf_pl` / `.vies` (attempt lines), `vatValidation.sources`,
    `vatValidation.attempt.reason.not_found`, `moderation.registryDivergenceLink`. The three older
    provider labels in the history table keep their `core` keys; only `gus_pl` is worded in the
    module bundle (the `_i18n` bundle is another module's).
