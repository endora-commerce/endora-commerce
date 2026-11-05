# Contract: storefront registration form with registry lookup

Read with `.claude/skills/ux-laws/SKILL.md` (states, WCAG 2.2 AA) and research R-10, R-11.
Surfaces: `storefront/app/(auth)/register/page.tsx` (Server Component),
`storefront/app/(auth)/register/actions.ts` (`'use server'`),
`storefront/components/auth/RegisterForm.tsx` (`'use client'`),
`storefront/lib/auth/register-form-state.ts` (state type and pure helpers),
`storefront/lib/api/registry-lookup.ts` (API bindings).

## 1. Page

1. Reads `getServerContext()` and `getRegistrationOptions()` (fails closed → `enabled: false`).
2. `?status=pending` → the existing acknowledgement, unchanged.
3. Otherwise renders `<RegisterForm lookupEnabled countries labels…/>`, with the
   `register.top` / `register.bottom` hooks around it as today.
4. `?error=` is no longer written; the page ignores it if present (old links).

## 2. Form state (`register-form-state.ts`)

```ts
interface RegisterFormValues {
  organizationName: string; taxId: string; country: string;
  street: string; postalCode: string; city: string;
  firstName: string; lastName: string; email: string;
  // never: password
}
interface RegisterFormState {
  values: RegisterFormValues;
  lookup: null | {
    status: 'found' | 'not_found' | 'unavailable' | 'invalid_tax_id' | 'unsupported_country' | 'rate_limited';
    lookupId: string | null;
    source: 'gus' | 'mf' | 'vies' | null;
    vatStatus: 'active' | 'exempt' | 'not_registered' | 'unknown' | null;
    activityStatus: 'active' | 'ceased' | 'unknown' | null;
    /** True when the registry supplied no name and no address (VIES '---'). */
    noDetails: boolean;
  };
  error: null | { code: string; message: string };   // the backend's translated message (registration refusal)
}
```

`valuesFromFormData(formData)` reads every field **except** `password`; a unit test asserts the
password never reaches the state, whatever the form posts.

## 3. Server action `registerFormAction(prev, formData)`

- `intent === 'lookup'`: `lookupCompany({ taxId, country, forwardedFor })` → on `found`, replace
  `organizationName` (if the registry gave a name), `street`, `postalCode`, `city`, `country` (the
  answer's) and `taxId` (left as typed) in `values`; keep the rest; set `lookup`. A 429 →
  `lookup.status = 'rate_limited'`; any other error → `'unavailable'`. Never redirects.
- `intent === 'register'` (default): `registerOrganization({ …, registryLookupId })` with the hidden
  `registryLookupId` field; success → `localeRedirect('/register?status=pending&email=…')` as today;
  `StorefrontApiError` → return `{ values, lookup: prev.lookup, error }`.
- `forwardedFor` = the incoming request's `x-forwarded-for` (`headers()`), as
  `storefront/lib/api/forms.ts` forwards it.

`lookupCompanyAction({ taxId, country })` — the same lookup call for the JavaScript path, returning
the `lookup` part plus the company values.

## 4. Layout and controls

Organization fieldset, in this order (both states):

1. **Country** — `CountryPicker`, `name="country"`, default `PL`.
2. **Tax ID** — `input#org-tax name="taxId"`, `autocomplete="off"`, `inputmode="text"`,
   `aria-describedby` → the hint (when lookup enabled) and the lookup status region.
   When lookup is enabled, beside it: **"Fetch company data"** —
   `<button type="submit" name="intent" value="lookup" formNoValidate>`; its accessible name is
   the visible text; min target 24×24 CSS px (WCAG 2.5.8), the design system's secondary button.
   Hint below the field: `auth.register.lookup.hint`.
3. Company name, street, postal code, city — as today, editable, `required`.
4. Hidden `registryLookupId` (value from state; cleared when the tax ID or country changes, with
   JavaScript).

Owner fieldset and the "Create account" button (`name="intent" value="register"`) unchanged.

## 5. States (ux-laws: every state designed)

| State | What the buyer sees |
| --- | --- |
| lookup disabled | no button, no hint; the manual form |
| idle | button enabled; hint |
| loading (JS) | button disabled with `aria-disabled` + spinner + text `auth.register.lookup.loading`; the company fields stay editable |
| found | company fields filled; status region: found message naming the source, plus a VAT-status line, plus a ceased line when applicable; the filled fields are briefly marked "filled from the registry" (text, not colour only) |
| found, no details | `auth.register.lookup.noDetails` |
| not found / unavailable / invalid / unsupported / rate limited | its message (§7); fields untouched; focus stays on the button |
| registration refused | the error message above the form (`role="alert"`), every value but the password kept, lookup outcome still shown |

The status region is one element, mounted empty on first render, `role="status"`
`aria-live="polite"`, placed after the tax-ID row, so its text is announced when it arrives
(WCAG 4.1.3). Errors of the registration use the existing `b2b-auth__error`, given `role="alert"`.

## 6. JavaScript behaviour

- Click on the button or Enter in the tax-ID field → `lookupCompanyAction` in `startTransition`;
  the form is not submitted; double activation is ignored while loading.
- Enter in any other field → registration: the form's default button is a visually hidden
  `intent=register` submit button placed first (`tabIndex=-1`, `aria-hidden`), so the submitter is
  the lookup button only when it is itself activated — with or without JavaScript (research R-10,
  revised in T060).
- On `found`: set the company fields (controlled inputs) and the country; set the hidden
  `registryLookupId`; focus stays on the button (no focus jump into a field the buyer did not ask
  for).
- Editing the tax ID or the country after a lookup clears `registryLookupId` and the status
  message (the reference would not match — the backend ignores it anyway, FR-020).
- Registration submits through `onSubmit` + `startTransition` (React would otherwise reset the
  uncontrolled owner fields after a refusal — the `RoleEditorForm` reason).

## 7. Storefront i18n keys (`storefront/lib/i18n/messages/auth.ts`, both blocks)

| Key | en-US | pl-PL |
| --- | --- | --- |
| `auth.register.lookup.button` | Fetch company data | Pobierz dane firmy |
| `auth.register.lookup.hint` | Enter your NIP or EU VAT number and choose the country, and we will fill in your company details from the public registry. You can change them before you create the account. | Wpisz NIP lub unijny numer VAT i wybierz kraj, a uzupełnimy dane firmy z publicznego rejestru. Przed założeniem konta możesz je zmienić. |
| `auth.register.lookup.loading` | Fetching company data… | Pobieramy dane firmy… |
| `auth.register.lookup.found` | Company details filled in from {source}. Check them and correct anything out of date. | Dane firmy uzupełnione z {source}. Sprawdź je i popraw, jeśli są nieaktualne. |
| `auth.register.lookup.source.gus` | the GUS REGON registry | rejestru REGON (GUS) |
| `auth.register.lookup.source.mf` | the Ministry of Finance VAT White List | Białej listy podatników VAT |
| `auth.register.lookup.source.vies` | the EU VIES system | systemu VIES |
| `auth.register.lookup.vat.active` | VAT status: active VAT payer. | Status VAT: czynny podatnik VAT. |
| `auth.register.lookup.vat.exempt` | VAT status: exempt from VAT. You can still register; our team will review your application. | Status VAT: zwolniony z VAT. Mimo to możesz się zarejestrować — nasz zespół zweryfikuje zgłoszenie. |
| `auth.register.lookup.vat.notRegistered` | The registry reports this company is not registered for VAT. You can still register; our team will review your application. | Według rejestru firma nie jest zarejestrowana jako podatnik VAT. Mimo to możesz się zarejestrować — nasz zespół zweryfikuje zgłoszenie. |
| `auth.register.lookup.vat.unknown` | VAT status not checked. | Status VAT nie został sprawdzony. |
| `auth.register.lookup.ceased` | The registry reports that this company has ceased its activity. | Według rejestru firma zakończyła działalność. |
| `auth.register.lookup.noDetails` | This VAT number is valid, but the registry does not share company details for this country. Enter them below. | Ten numer VAT jest prawidłowy, ale rejestr nie udostępnia danych firm z tego kraju. Wpisz je poniżej. |
| `auth.register.lookup.notFound` | We could not find this tax ID in the registry. Check the number or enter your company details below. | Nie znaleźliśmy tego numeru w rejestrze. Sprawdź numer albo wpisz dane firmy poniżej. |
| `auth.register.lookup.unavailable` | The registry is not responding right now. Enter your company details below. | Rejestr w tej chwili nie odpowiada. Wpisz dane firmy poniżej. |
| `auth.register.lookup.invalidTaxId` | This tax ID does not look valid. Check the number. | Ten numer wygląda na nieprawidłowy. Sprawdź go. |
| `auth.register.lookup.unsupportedCountry` | Automatic lookup is not available for this country. Enter your company details below. | Automatyczne pobieranie danych nie jest dostępne dla tego kraju. Wpisz dane firmy poniżej. |
| `auth.register.lookup.rateLimited` | Too many lookups in a short time. Wait a few minutes or enter your company details below. | Zbyt wiele zapytań w krótkim czasie. Odczekaj kilka minut albo wpisz dane firmy poniżej. |
| `auth.register.lookup.filledMark` | Filled from the registry | Uzupełniono z rejestru |

The page's existing `auth.register.failed` stays the fallback for an unexpected refusal.

`vat.unknown` is deliberately neutral: the storefront cannot tell (and is not told — research R-11)
whether the status is unknown because the Polish-sources setting is `gus` or because the White List
did not answer, and the sentence is true in both cases. The `found` message names the source the
answer carries, so under `gus` it says GUS, under `mf` the White List.

## 8. Tests (storefront, vitest)

- `test/auth/register-form-state.test.ts` — password never in state; lookup merges company values;
  refusal keeps values.
- `test/auth/register-registry-lookup.test.tsx` — options off → no button and no hint; on →
  button, hint, empty live region; each lookup status renders its message; with no JS (server
  render of a returned state) the values are prefilled and the hidden reference is set.
- `test/lib/registry-lookup-api.test.ts` — options fail closed; lookup forwards
  `x-forwarded-for`; 429 → `rate_limited`.
- `test/auth/auth-pages-i18n.test.tsx` and `test/auth/register-customer-closed-store.test.tsx`
  updated for the new component.
- Accessibility: the conformance suite (`playwright.conformance.config.ts`) gains the register
  page with lookup enabled and a found state, run under axe.
