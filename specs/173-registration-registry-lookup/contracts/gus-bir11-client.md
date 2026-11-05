# Contract: GUS BIR1.1 client (`organizations`, internal)

File: `packages/modules/organizations/src/backend/integrations/gus-bir-client.ts`, envelopes and
extraction in `integrations/gus-bir-soap.ts`. Implements `CompanyRegistryClient` (research R-2)
with `provider = 'gus_pl'`. No new dependency (research R-5). Protocol facts: research R-4 —
**verified by spike T001 before this file is implemented**; a fact the spike corrects is corrected
here and in research, not worked around in code.

## 1. Construction

```ts
interface GusBirClientOptions {
  /** Resolved per lookup; null ⇒ GUS not configured (the lookup skips this leg). */
  resolveCredential: () => Promise<{ apiKey: string; environment: 'production' | 'test' } | null>;
  fetchImpl?: typeof globalThis.fetch;
  requestTimeoutMs?: number;   // default 4000
  totalTimeoutMs?: number;     // default 6000 — login + search (+ one re-login and retry)
  now?: () => number;
  logger?: { warn(obj: object, msg: string): void; info(obj: object, msg: string): void };
}
```

Endpoints are constants keyed by `environment`; nothing else selects a URL.

## 2. Envelopes (SOAP 1.2, `Content-Type: application/soap+xml; charset=utf-8`)

`{endpoint}` is the selected endpoint; `{key}` is XML-escaped; `{nip}` is ten digits.

**Zaloguj**

```xml
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS/BIR/PUBL/2014/07">
  <soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">
    <wsa:To>{endpoint}</wsa:To>
    <wsa:Action>http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Zaloguj</wsa:Action>
  </soap:Header>
  <soap:Body><ns:Zaloguj><ns:pKluczUzytkownika>{key}</ns:pKluczUzytkownika></ns:Zaloguj></soap:Body>
</soap:Envelope>
```

**DaneSzukajPodmioty** — HTTP header `sid: {sid}`

```xml
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS/BIR/PUBL/2014/07" xmlns:dat="http://CIS/BIR/PUBL/2014/07/DataContract">
  <soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">
    <wsa:To>{endpoint}</wsa:To>
    <wsa:Action>http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DaneSzukajPodmioty</wsa:Action>
  </soap:Header>
  <soap:Body>
    <ns:DaneSzukajPodmioty><ns:pParametryWyszukiwania><dat:Nip>{nip}</dat:Nip></ns:pParametryWyszukiwania></ns:DaneSzukajPodmioty>
  </soap:Body>
</soap:Envelope>
```

**GetValue** — HTTP header `sid: {sid}`; `{name}` is `KomunikatKod` or `StatusSesji`

```xml
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS/BIR/2014/07">
  <soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">
    <wsa:To>{endpoint}</wsa:To>
    <wsa:Action>http://CIS/BIR/2014/07/IUslugaBIR/GetValue</wsa:Action>
  </soap:Header>
  <soap:Body><ns:GetValue><ns:pNazwaParametru>{name}</ns:pNazwaParametru></ns:GetValue></soap:Body>
</soap:Envelope>
```

## 3. Reading a response

1. Body > 256 KB, or containing `<!DOCTYPE` / `<!ENTITY` → `invalid_response`.
2. Cut from the first `<(prefix:)?Envelope` to the matching `</(prefix:)?Envelope>` (the body is MTOM).
3. Read `<ZalogujResult>`, `<DaneSzukajPodmiotyResult>` or `<GetValueResult>` text (namespace
   prefix tolerated); decode `&lt; &gt; &amp; &quot; &apos;` and `&#N;` / `&#xH;`.
4. For a search: split the decoded document into `<dane>` blocks; read leaves by name; decode
   entities in each value; trim.

## 4. Outcomes

| Situation | `CompanyRegistryAnswer` |
| --- | --- |
| no credential | not called — the lookup records `{ provider: 'gus_pl', outcome: 'skipped', errorKind: 'not_configured' }` |
| `ZalogujResult` empty | `unavailable`, `gus_invalid_key` (warn once per fingerprint per hour) |
| ≥ 1 `<dane>` with `Regon` | `found`, record per research R-4 (unit selection, address composition) |
| `<dane>` with `ErrorCode` `4` (observed in T001, with `ErrorMessagePl`, `ErrorMessageEn`, `Nip`) or an empty result with `KomunikatKod` `4` | `not_found` |
| empty `DaneSzukajPodmiotyResult` and `StatusSesji` `0` (T001: a stale sid gives an empty result, an **empty** `KomunikatKod` — not `7` — and `StatusSesji` `0`); also `KomunikatKod` `7` | clear session, re-login once, retry once; then `unavailable`, `gus_session` |
| any other code | `unavailable`, `gus_code_<n>` |
| HTTP ≥ 500, network error | `unavailable`, `provider_<status>` / `network_error` |
| timeout | `unavailable`, `network_timeout` |
| unreadable body | `unavailable`, `invalid_response` |

Never throws (the `VatValidator` port's degrade-safely rule, applied here).

## 5. Session (research R-9)

In-memory `{ sid, fingerprint, lastUsedAt }`; reuse when `now - lastUsedAt < 50 min` and the
fingerprint (SHA-256 of `environment + ':' + apiKey`) matches; single-flight login. The sid and the
key are never logged, never put in an error kind, never returned.

## 6. Tests (beside the subject, harness-free)

`gus-bir-soap.test.ts` and `gus-bir-client.test.ts`, driven by fixture bodies whose **framing**
(MTOM boundaries, headers, namespaces, escaping) is copied from what the spike captured from the
**test** environment with the public test key, and whose **data values are replaced with synthetic
ones** (no natural person's name or address from a registry enters the tree), stored beside the
tests (`integrations/fixtures/gus/*.txt`): MTOM success with one and with several units, a unit with an
end date, a village address without a street, not found in both spellings, expired session then
success, empty login, HTTP 500, timeout (fake fetch never resolving), DTD present, oversized body.
An assertion that the key and sid never appear in anything the logger received.
