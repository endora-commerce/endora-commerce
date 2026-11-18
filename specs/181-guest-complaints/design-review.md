# Design review: feature 181, complaints from guests (storefront guest flow, two admin issues)

**Feature**: `specs/181-guest-complaints/` | **Task**: T061 | **Date**: 2026-11-16 | **Reviewer**: `endora-commerce-designer`
**Scope**: every guest storefront surface T061 lists, before any of them is built (batch 4), plus two
admin issues raised in batch 3. This is a review. It changes no spec, plan, task or code.
**Basis**: `spec.md`, `plan.md`, `research.md` (R-3, R-4, R-5, R-10, R-12, R-13), `contracts/guest-api.md`,
`quickstart.md`, the predecessor `specs/180-off-platform-complaints/design-review.md`,
`.claude/skills/ux-laws/SKILL.md`, and the working tree as it stands on `feat/180-off-platform-complaints`.

The document has three parts:

- **Part 1: findings.** Each finding is marked **needs-owner-ruling** (it changes the spec, plan or
  a contract) or **accept-in-scope** (T074 applies it with no artefact change). Accept-in-scope
  findings are graded *must fix*, *should fix* or *nice to have*.
- **Part 2: the design of each surface.** Layout, copy direction in Polish and English, states,
  accessibility and the primitives to reuse. It can be built from directly.
- **Part 3: the two admin issues.** The focus problem in the guest-action dialogs and the list
  search box.

The Polish copy is what the owner reads. New Polish strings avoid gendered past-tense forms
(*kupiłeś*) where a neutral wording reads as naturally; the reused 180 strings stay as they are.

---

## Part 1: findings

### Needs an owner ruling

**O-1. The tracking page cannot say why a complaint was rejected (contract G8, FR-041).**
A signed-in customer's case page shows the rejection reason (`storefront/app/(account)/returns/[id]/page.tsx:133`).
`guestCaseViewSchema` (`packages/contracts/src/returns.ts:700`) carries no `rejectionReason`.
A rejected guest would see the status *Odrzucona* and nothing else on the one page they have. The
rejection e-mail is their only record, and a second visit to the page tells them less than the e-mail
did. The reason is customer-visible text, not a staff-only note, so FR-041's exclusion does not apply
to it. This is the worst error peak of the guest journey *(Peak-End Rule)*.
→ **Recommended**: add `rejectionReason: z.string().nullable()` to `guestCaseViewSchema` and to
contract G8, and add "the rejection reason, when there is one" to FR-041's list. The page shows it as
the account page does: a `b2b-auth__notice` under the status. **Alternative**: leave it out. The page
then shows a fixed sentence under a rejected status: "Uzasadnienie wysłaliśmy e-mailem." / "We sent
the reason by e-mail."

**O-2. The storefront cannot tell whether a live guest session belongs to *this* link (research R-3 item 5, R-13 *verify* row).**
R-13 says the GET *verify* page "with a live session for that verification, redirects to the form",
and R-3 item 5 says the handler continues when it "sees a live guest-session cookie for the same
verification". The token is sealed and the session cookie is opaque. Neither G3 nor G5 tells the
storefront which verification a session came from, so the storefront cannot do what those two
sentences say.
→ **Recommended**: the GET page always shows *Continue*. It never redirects, so a mail scanner
always gets the same page. If the POST is refused with `410` and the browser holds **any** live guest
session (G5 answers `200`), the handler continues to the form. The form shows the locked, verified
address at the top (S-5), so a session for a different address is visible to the person straight
away. T063's case "a live session for the same verification continues to the form" is then written
as "a live guest session continues to the form". **Alternative**: the storefront forwards the guest
cookie on G3, and the backend answers success when the cookie's session is the token's verification.
That is a backend and contract change for a case the recommended option already handles.

**O-3. "Offering to send a new link to the same address" (spec edge case *Verification link expired or already used*).**
G3's `410` is deliberately uniform and carries no address, and it must stay that way: an answer that
named the address would turn a leaked or forwarded link into a disclosure. In a different browser
from the one that requested the link, the storefront therefore does not know "the same address".
→ **Recommended**: the *link no longer works* page offers *Send a new link* with the e-mail field
**prefilled** when this browser still holds the pending-request cookie (F-7), and **empty**
otherwise. Reword the edge case to "offers to send a new link, with the address filled in when the
same browser requested the link". **Alternative**: keep the wording. That would need G3 to disclose
the address, which this review advises against.

### Accept in scope (T074)

#### Must fix

**F-1. The account layout probably redirects a signed-out visitor before the page can (T072, and 180's D-14).**
`storefront/app/(account)/layout.tsx:47` sends every signed-out request in the `(account)` group to
`/login?next=/account`. The pages' own redirects, 180's D-14 at `returns/new/page.tsx:65` and 181's
planned redirect to `/returns/guest?from=…`, sit **below** that layout. A layout that redirects before
returning its children most likely wins, so neither the guest choice (FR-010) nor D-14's
query-preserving `next` would ever reach a visitor. The existing test
(`storefront/test/account/returns-off-platform.test.tsx:100`) renders the page alone, so it cannot
see this. I could not confirm it on the running stack: the dev storefront answered `503
/service-unavailable`.
→ **Fix**:
1. Verify first, signed out, with `curl -sI '/returns/new?origin=elsewhere'`.
2. If the layout wins, have the middleware also pass the query. It already sets `x-pathname`
   (`storefront/middleware.ts:128, 221`); add `x-search`.
3. In `(account)/layout.tsx`, for `/returns` and `/returns/new`, call the same pure function the pages
   use, for example `signedOutReturnsTarget(path, query, guestEnabled)` in `lib/returns/returnForm.ts`.
4. Keep the pages' own redirect so they stay testable alone.
5. Add one test that renders the layout signed out.

Paths: `storefront/app/(account)/layout.tsx`, `storefront/middleware.ts`, `storefront/lib/returns/returnForm.ts`.

**F-2. Analytics would send the tracking token and the verification token to Google.**
`components/analytics/PageViewTracker.tsx:27-38` sends `pathname?query` to GA4 and GTM on every
navigation, and `lib/analytics/gtag.ts:92` sets `page_location: window.location.href`. On
`/returns/track/<token>` and `/returns/guest/verify?token=…` the token is a bearer credential: it grants
reading the guest's personal data and writing to the case. Sending it to a third party defeats FR-040's
purpose, and `Referrer-Policy: no-referrer` alone does not stop it.
→ **Fix (defence in depth)**:
1. **A pure predicate** `isSecretBearingPath(path)` in `lib/analytics/` (new function, not a new
   component). It matches `/returns/track/` and `/returns/guest/verify`, with or without the locale
   prefix.
2. **No analytics scripts on those documents.** The root layout already reads `x-pathname`
   (`app/layout.tsx:271`). Do not render `<GoogleTagManager>` / `<GtmProvider>` / the gtag loader
   when the predicate matches.
3. **Redaction.** `PageViewTracker` and `sendPageView` replace the secret segment with `[token]`, and
   drop the query, for a client-side navigation into those paths, where the scripts are already
   loaded.
4. **Links into the tracking page.** The success page's *Open the complaint page* is a plain `<a>`,
   not `LocalizedLink`, so it is a document load and item 2 applies.

A cleaner option is to exchange the token for a path-scoped cookie and redirect to a URL that holds no
token. That changes R-5's storefront route, so it is not proposed here. Raise it as a follow-up if
the owner wants the address bar free of the token as well.
Paths: `storefront/app/layout.tsx`, `storefront/components/analytics/PageViewTracker.tsx`, `storefront/lib/analytics/gtag.ts`.

**F-3. A double click on *Continue* lands the person on *this link no longer works*.**
A double click sends two redeem POSTs before the first answer sets the cookie. The second gets `410`,
and its page is the one the browser shows. The first complaint the visitor sees is an error they did
not cause *(Peak-End, Doherty)*.
→ **Fix**:
- (a) *Continue* disables itself on submit, with a spinner and `aria-busy` (F-9).
- (b) On `410` the POST handler does **not** render the error. It answers `303` to
  `/returns/guest/verify?token=…&state=invalid`. That GET re-checks the guest cookie (G5) and continues
  to the form if the first POST's cookie has landed (O-2). Otherwise it shows the *no longer works*
  page.

Paths: `storefront/app/returns/guest/verify/{page.tsx,route.ts}`.

**F-4. The guest form must not send `contact.email` (contract G7 is `.strictObject`).**
The 180 handler forwards `contact.email` (`returns/new/page.tsx:461` posts it).
`createGuestComplaintRequestSchema.contact` is strict and has no `email`, so the API would refuse every
guest submission with `400 VALIDATION_FAILED`. The guest form renders the address as text, not as an
input (S-5), and the guest submit handler builds `contact` from `name` and `phone` only. A test should
assert that a posted `contact.email` is dropped.
Paths: `storefront/app/returns/guest/submit/route.ts`.

**F-5. The verification page must never submit itself.**
That means no `useEffect` auto-POST, no `<meta http-equiv="refresh">` and no auto-focus-then-submit.
Scanners that run JavaScript would otherwise redeem the one-time link, which is exactly the failure
R-3 item 3 exists to prevent. The page also carries `noindex` and `Referrer-Policy: no-referrer`, as
the tracking page does. Add a `headers()` entry for `/returns/guest/verify` and
`/returns/track/:path*` after the catch-all in `storefront/next.config.js:191-201`; the later rule wins.
Paths: `storefront/app/returns/guest/verify/page.tsx`, `storefront/next.config.js`.

**F-6. The neutral invalid-link page must not swallow the module-off state (FR-080, SC-008).**
Render the neutral page from `app/returns/track/[token]/not-found.tsx`, and call `notFound()` from the
page on `404 RETURN_TRACKING_LINK_INVALID`. The module gate (`requireModulePresent`) sits one level up
in `app/returns/track/layout.tsx`. A `notFound()` thrown by a layout renders the **parent's** boundary,
so module-off still gives the site's generic not-found page and never the neutral page with its
"contact the shop" line. The HTTP status is `404` in both cases. Add one test for each.
Paths: `storefront/app/returns/track/[token]/not-found.tsx`, `storefront/app/returns/track/layout.tsx`.

**F-7. The *sent* page needs the address, and the address must not travel in the URL.**
Issue #745's rule is that no address goes in the URL (`(auth)/password-reset/request/page.tsx:27,88`).
The *sent* page still needs the address for three things: showing it so a typo is caught (spec edge
case *E-mail typo*), *Send again*, and prefilling *Use a different address*.
→ **Fix**: the request handler sets an `HttpOnly; SameSite=Lax; Path=/returns/guest` cookie
`b2b_returns_guest_pending` holding `{ email, requestedAt, linkValidMinutes }`. Its lifetime is the
guest session's (24 h), so it also serves F-14 and O-3. *Leave* deletes it. Showing the address the
visitor typed reveals nothing: the page is identical whatever the address (FR-021 holds). Without the
cookie (a direct visit, or the cookie expired) the page shows the address-free variant (S-2).
Paths: `storefront/app/returns/guest/request/route.ts`, `storefront/app/returns/guest/sent/page.tsx`, `storefront/lib/session.ts`.

**F-8. The tracking token has to reach the success page safely (R-13 does not say how).**
G7 answers `trackingToken` once, and the handler then `303`s to `/returns/guest/submitted/<ref>`.
→ **Fix**: an `HttpOnly; Path=/returns/guest/submitted; Max-Age=1800` flash cookie
`{ ref, trackingToken, email }`. The page renders the link only when the cookie's `ref` equals the
path's `ref`. Otherwise it redirects to `/returns/guest`, so a guessed URL shows nothing, not even a
false "received". A refresh within 30 minutes still shows the link. After that, the e-mail is the
way back. The `submissionKey` replay (`200` with the case already filed) re-sets the same cookie, so a
double submit lands on the same page.
Paths: `storefront/app/returns/guest/submit/route.ts`, `storefront/app/returns/guest/submitted/[ref]/page.tsx`.

#### Should fix

**F-9. Pending state for the route-handler forms: extend `CartSubmitButton`, do not add a new button.**
`components/CartSubmitButton.tsx` reads `useFormStatus`. That only reports a pending state for a
function action, and every guest form posts to a route handler (a string action, R-13).
→ **Fix**: give `CartSubmitButton` a `trackNativeSubmit` prop. The button listens for its form's
`submit` event and sets `disabled`, `aria-busy` and the spinner (`.b2b-spin`, which already honours
reduced motion) until `pagehide`. Use it on *Send the link*, *Continue*, *Submit complaint*, *Send
message* and *Upload*. Constitution IX: one pending button, two trigger modes.
Paths: `storefront/components/CartSubmitButton.tsx`.

**F-10. Reuse the 180 form by extraction, not by copying it into the guest page.**
The no-order form is a function **local** to `app/(account)/returns/new/page.tsx:354-514`
(`OffPlatformForm`), not a component. T070's path list names the leaves but not this function. A guest
page that copied it would fork 160 lines.
→ **Fix**:
- Move it to `components/returns/OffPlatformForm.tsx` (Server Component).
- Give it `mode: 'customer' | 'guest'` and `action` (`/returns/submit` or `/returns/guest/submit`).
- Give `AttachmentField` and `OffPlatformLines` an `uploadAction` prop (default `/returns/uploads`).
  `AttachmentField.tsx:100` hard-codes the URL today.
- In guest mode, the contact section renders as S-5 describes, the *← Choose an order instead* link
  is not rendered, and *Cancel* goes to `/`.

Paths: `storefront/components/returns/{OffPlatformForm,AttachmentField,OffPlatformLines}.tsx`, `storefront/app/(account)/returns/new/page.tsx`.

**F-11. Copy goes in `lib/i18n/messages/account.ts`, not `core.ts` (T073 path).**
Every `returns.*` storefront key lives in `account.ts`: English from line 380, Polish from 1038. Put
`returns.guest.*` beside them. One bundle for one feature's copy keeps the two languages side by side
for review.
Paths: `storefront/lib/i18n/messages/account.ts`.

**F-12. Share the case page's sections with the tracking page.**
The tracking page shows the same products, purchase, contact, files and conversation as
`(account)/returns/[id]/page.tsx:137-384`. Extract presentational Server Components (`CaseItems`,
`CasePurchaseContact`, `CaseFiles`, `CaseConversation`) into `components/returns/CaseSections.tsx`. Feed
them from either `ReturnCaseDetail` or `GuestCaseView` through a pure adapter in `lib/returns/`, which
is testable under `renderToString`.

Two differences are deliberate:
- **No image previews on the tracking page.** The view has no `mimeType`, and every `<img>` would
  fetch through the token URL. Files are icon tiles with the type label (`b2b-stacked__file-icon`).
- **Comment authors.** `authorKind: 'shop' | 'you'` maps to "Sklep" / "Shop" and "Ty" / "You".

Paths: `storefront/components/returns/CaseSections.tsx`, `storefront/lib/returns/caseView.ts`, `storefront/app/(account)/returns/[id]/page.tsx`.

**F-13. `.b2b-badge` has no style.**
The case page's "Kupione gdzie indziej" badge (`[id]/page.tsx:131`) renders as plain text: no rule for
`.b2b-badge` exists in `app/globals.css`. The guest surfaces need it twice: *Zweryfikowany* on the
locked e-mail and *Bought elsewhere* on the tracking header.
→ **Fix**: one rule beside `.b2b-stacked__status`, using tokens only: `border: 1px solid var(--line);
background: var(--surface-alt); color: var(--color-fg-soft)`, a 999 px radius, 12 px text and an
inline-flex gap for an optional icon. Not a new primitive: the class name exists and is used.
Paths: `storefront/app/globals.css`.

**F-14. Session expiry at submission loses less.**
On `401 RETURN_GUEST_SESSION_REQUIRED` the submit handler:
- keeps the typed answers in 180's attempt cookie;
- answers `303` to `/returns/guest?reason=session_expired&from=/returns/guest/new`, with the address
  prefilled from F-7's cookie.

After the new link, the form restores the answers. The page says files must be added again: they were
owned by the expired session (R-4).
Paths: `storefront/app/returns/guest/submit/route.ts`, `storefront/app/returns/guest/page.tsx`.

**F-15. A confirmation present at page load is not a live-region announcement.**
After a `303`, text already inside `role="status"` is not reliably announced (ux-laws §4).
- On the success page the confirmation **is the `<h1>`**.
- After posting a comment or a file on the tracking page, the handler redirects to
  `…?comment=added#conversation` or `…#files`. The target heading has `tabIndex={-1}` and an `id`, so
  the browser moves the reading point to it, and the result line sits directly under it.

The account case page has the same pattern (`[id]/page.tsx:116, 251`). It is not changed here.

**F-16. The *Leave* control and its placement.**
`/returns/guest/leave` exists, but no surface names it. It goes in two places:
- the form's top strip, as *Use a different address* (S-5);
- the success page, as *Done – end session* (S-6).

On the form it is `<button type="submit" form="guest-leave">`, pointing at a separate
`<form id="guest-leave" method="post" action="/returns/guest/leave">` placed **outside** the main
form. A form cannot nest inside another, and the `form` attribute is the valid way to do this. It sits
at the top, before anything is typed, because leaving discards the typed answers *(Fitts: destructive
distance)*.

**F-17. Sentences for the new refusals** (FR-090; each a `returns.guest.errors.*` key, never the raw
code). The copy is in S-1, S-5 and S-7. The codes are:
- `VALIDATION_FAILED` on the e-mail;
- `RATE_LIMITED`;
- `RETURN_GUEST_COMPLAINTS_DISABLED`;
- `RETURN_GUEST_SESSION_REQUIRED`;
- `RETURN_GUEST_LIMIT_REACHED` with `cases_per_session`, `cases_per_address` and `comments_per_case`;
- `409 case_terminal` on the tracking page.

**F-18. Fix the admin guest-action focus in `RowActionMenu`, not in each module** (Part 3, A-1).
Paths: `packages/admin-kit/src/components/RowActionMenu.tsx`, plus a test.

**F-19. The admin list search sends `q`** (Part 3, A-2).
Paths: `packages/modules/returns/src/admin/pages/ReturnsList.tsx`, `packages/modules/returns/i18n/{en,pl}.json`.

#### Nice to have

**F-20.** Put a `RowActionMenuSeparator` between *Send a new tracking link* and *Erase personal
data* (`ReturnDetail.tsx:1023-1030`), so the irreversible item is not adjacent to a routine one *(Fitts:
destructive actions get distance)*.

**F-21.** On a detail page, an icon-only ⋮ hides the only two guest actions. Use a labelled
`DropdownMenu` trigger, "Dane gościa ▾" / "Guest data ▾", built from the kit's `Button
variant="outline"` and the same items. `RowActionMenu` is meant for table rows *(Picture
Superiority: icon plus label on a path that matters)*.

**F-22.** Two login pages each define their own `sanitiseNext` (`(auth)/login/page.tsx:196`,
`login/mfa/page.tsx:91`). The guest entry page needs the same rule for `from`, to prevent an open
redirect. Move it to `lib/auth/` and reuse it rather than writing a third copy.

---

## Part 2: the design of each surface

**Shared frame.**
- **Card pages** (entry, *sent*, *Continue*, *no longer works*, neutral invalid link) use
  `.b2b-auth`: the 480 px centred card of the sign-in and password-reset pages. A visitor who meets
  "enter your e-mail, get a link" already knows that layout from those pages *(Jakob)*.
- **Long pages** (form, success, tracking) use `.b2b-auth.b2b-stacked`, which zeroes the card's
  margin and border because it assumes the account panel around it. The guest layouts therefore wrap
  their children in `<div className="mx-auto w-full max-w-[720px] px-4 py-8 sm:py-12">`. That uses
  utilities only, with no new CSS.
- **Every page**: `robots: { index: false, follow: false }`; `requireModulePresent('returns')` in the
  layout; copy through `tForLocale(locale)`.
- **Pending state**: every submit is `CartSubmitButton` with `trackNativeSubmit` (F-9).

### S-1. Entry: `/returns/guest` (FR-010, US1 scenarios 1–3)

**When it renders.** A signed-out visitor, with `availability.enabled`.
- Signed in: redirect to the sanitised `from`, or to `/returns/new?origin=elsewhere`.
- Not enabled: redirect to `/login?next=<from>`, as today (FR-010).

**Layout** (one `.b2b-auth` card, two bounded regions stacked at every width):

```
h1  Reklamacja produktu                                    File a complaint
── region A ───────────────────────────────────────────────
h2  Masz u nas konto?                                      Have an account with us?
p   Zaloguj się. Zakupy z naszego sklepu reklamujesz       Sign in. Purchases from our shop are
    z konta i tam śledzisz zgłoszenie.                     claimed from your account, where you
                                                           follow the complaint.
[ Zaloguj się ]  (a.btn.btn--outline → /login?next=from)   [ Sign in ]
──────────────────── lub / or ────────────────────  (.b2b-auth__social-divider)
── region B ───────────────────────────────────────────────
h2  Kontynuuj bez konta                                    Continue without an account
p   Dla produktów kupionych w innym sklepie lub            For products bought in another shop or
    u dystrybutora. Podaj e-mail – wyślemy link            from a distributor. Enter your e-mail and
    do formularza reklamacji.                              we'll send you a link to the complaint form.
<form method=post action=/returns/guest/request>
  [Adres e-mail]        type=email autoComplete=email      [E-mail address]
                        inputMode=email placeholder=" "
  p.b2b-auth__hint      Użyjemy go tylko do obsługi tej    We use it only to handle this complaint:
                        reklamacji: wyślemy na niego       the link, the confirmation and our
                        link, potwierdzenie i odpowiedzi.  replies go there.
  hidden: from, language; honeypot
  [ Wyślij link ]  (CartSubmitButton, btn btn--primary btn--block)   [ Send me the link ]
</form>
```

**Decisions.**
- **Two regions, one decision** *(Hick)*. The guest path is the familiar "sign in / continue as
  guest" checkout pattern *(Jakob)*. Sign-in comes first because the spec routes everything bought
  from this shop there (scenario 1), and *Masz u nas konto?* also catches an account holder who bought
  elsewhere: their complaint then lands in their account.
- **The e-mail field is inline in region B**, not behind a *Continue without an account* button.
  The heading carries the spec's wording, and the visitor saves one click and one page *(Tesler)*.
- **One filled button**: *Wyślij link* *(Von Restorff)*. *Zaloguj się* is outline, a one-tap link.
  No *Create an account* link: account creation is out of scope, and a third path costs a decision.
- **The honeypot** follows `cms-components` `ContactForm.tsx:323-325`: a wrapper with
  `aria-hidden="true"`, positioned off-screen with utilities, holding `<input name="hp" tabIndex={-1}
  autoComplete="off">`. Never `display:none`, which some bots skip.
- **Prefill.** With F-7's cookie (*Use a different address*, F-14, O-3), the field is prefilled and
  the visitor corrects one character rather than retyping the address *(Postel)*.

**States.**

| State | Rendering |
| --- | --- |
| Pristine | as above |
| Malformed address (`400`) | Field error under the input: "Wpisz pełny adres e-mail, np. anna@example.com." / "Enter a full e-mail address, e.g. anna@example.com." The input gets `aria-invalid` and `aria-describedby="email-hint email-error"`, and focus goes to it |
| `429 RATE_LIMITED` | `.b2b-auth__error role="alert"` above the form: "Zbyt wiele prób. Spróbuj ponownie za kilka minut." / "Too many attempts. Try again in a few minutes." It names no address (plan departure 5) |
| `403` disabled mid-flow (FR-002) | Region B is replaced by a `.b2b-auth__notice`: "Reklamacje bez konta nie są już tu przyjmowane. Zaloguj się albo skontaktuj się z nami." / "Complaints without an account aren't accepted here any more. Sign in or contact us." It links to the contact page the footer uses (`kontakt`) |
| `?reason=session_expired` (F-14) | A `.b2b-auth__notice` above region B: "Sesja formularza wygasła. Wyślemy nowy link – zapisane odpowiedzi zachowamy, pliki trzeba będzie dodać ponownie." / "Your form session expired. We'll send a new link: your answers are kept, but files need adding again." |
| No JS | Identical. A plain POST and a `303` |
| Loading | Server-rendered; nothing to load. The submit shows its pending state (F-9) |

**Accessibility.** Focus order is h1 → *Zaloguj się* → e-mail → *Wyślij link*. The floating label
needs `placeholder=" "`, as on the login page. The hint is linked by `aria-describedby`. Both buttons
are at least 44 px tall on mobile (`btn--block` under 480 px).

### S-2. Sent: `/returns/guest/sent` (FR-021, US1 scenario 4, edge case *E-mail typo*)

```
h1  Sprawdź skrzynkę                                         Check your inbox
p   Jeśli na adres {email} można dostarczyć wiadomość,       If {email} can receive e-mail, we've just
    właśnie wysłaliśmy link do formularza reklamacji.        sent it a link to the complaint form.
    Link działa przez {minutes} minut i można go             The link works for {minutes} minutes and
    użyć jeden raz.                                          can be used once.
p.b2b-auth__hint
    Nie widzisz wiadomości? Zajrzyj do folderu spam          Can't see it? Check your spam or
    lub oferty. Każdy nowy link unieważnia poprzedni –       promotions folder. Each new link replaces
    użyj tego z najnowszej wiadomości.                       the previous one, so use the newest e-mail.
<form post /returns/guest/request>  (address from the cookie, F-7)
  [ Wyślij link ponownie ]  btn--outline                     [ Send the link again ]
  span (JS only): Ponowne wysłanie za {s} s                  You can resend in {s} s
</form>
a  Użyj innego adresu  → /returns/guest (prefilled)          Use a different address
```

**Decisions.**
- **The address is printed in `<strong>`.** This is what catches the typo. It is safe because the
  page is identical for every address (F-7).
- **"Each new link replaces the previous one."** FR-022 supersession would otherwise send a person who
  asked twice into the first e-mail's link and onto the *no longer works* page.
- **No filled button on the page.** The next step happens in the mailbox. *Send again* is outline,
  so it does not invite resending immediately *(Von Restorff)*.
- **60-second wait.**
  - With JS, a small client leaf keeps *Send again* `disabled` and shows the countdown text, which is
    **not** in a live region. When the button enables, a `role="status"` region mounted empty
    announces once: "Możesz wysłać link ponownie." / "You can send the link again."
  - Without JS, the button is enabled. A POST sooner than 60 s after `requestedAt` re-renders the
    page with the hint "Poczekaj chwilę przed ponownym wysłaniem." / "Please wait a moment before
    sending again." That depends only on this browser's own cookie, so it reveals nothing.

**States.**

| State | Rendering |
| --- | --- |
| With cookie | as above |
| Without cookie (direct visit, expired) | The same heading, the address-free sentence "Jeśli podany adres może odbierać wiadomości…" / "If the address you entered can receive e-mail…", no *Send again*, and *Use a different address* as *Wpisz adres ponownie* / *Enter your address again* |
| Throttled, honeypot, send failure | **The same page.** It is uniform by contract (G2) |
| `429` on resend | The S-1 sentence, as a `.b2b-auth__error role="alert"` |

### S-3. *Continue*: `/returns/guest/verify?token=…` (R-3 item 3, plan departure 4)

```
h1  Przejdź do formularza reklamacji                         Continue to the complaint form
p   Ten dodatkowy krok chroni Twój jednorazowy link.         This extra step keeps your one-time link safe.
<form method=post action=/returns/guest/verify>
  hidden: token
  [ Przejdź dalej ]  btn--primary btn--block                 [ Continue ]
</form>
```

**Decisions.**
- **One sentence of why.** An unexplained extra click reads as a broken link; a long explanation is
  noise. Scanners are not mentioned, because the visitor does not need the mechanism.
- **The button is not auto-focused.** Auto-focus plus a key press is a near-automatic submit, and the
  page's purpose is a deliberate act. It is the only control, so it is the first Tab stop.
- **The page never submits itself (F-5).** It renders the same for every token, valid or not. The
  GET opens nothing (O-2).

**States.**
- Pending: the button is disabled with a spinner and *Otwieranie…* / *Opening…* (F-9, F-3).
- Missing `token`: the S-4 page.
- No JS: identical.

### S-4. Link no longer works: `/returns/guest/verify?…&state=invalid` (edge case, F-3, O-3)

```
h1  Ten link już nie działa                                  This link no longer works
p   Link mógł wygasnąć (działa {minutes} minut), zostać      It may have expired (links work for
    już użyty albo zastąpiony nowszym. Jeśli masz od         {minutes} minutes), been used already, or
    nas nowszą wiadomość, użyj linku z niej. Możemy też      been replaced by a newer one. If you have a
    wysłać nowy.                                             newer e-mail from us, use the link in it.
                                                             Or we can send you a new one.
<form post /returns/guest/request>
  [Adres e-mail]  (prefilled when this browser holds the cookie, O-3)
  [ Wyślij nowy link ]  btn--primary                         [ Send a new link ]
</form>
```

**Decisions.**
- **The three causes are named without saying which one applied.** The answer is uniform, and it
  must not hint at whether the address exists.
- **The fix is offered on the page.** The visitor never has to find the entry page again
  *(Peak-End: the error peak carries its own way out)*.
- **While the setting is off (FR-002)**, the form is replaced by the S-1 *disabled* notice.

### S-5. Guest form: `/returns/guest/new` (US1 scenario 5, FR-031, edge case *signed-in customer*)

This is 180's no-order form (`OffPlatformForm`, extracted by F-10) in `mode="guest"`. Everything not
listed here is exactly 180's: the sections, `ProductField`, `LineSlots`, `AttachmentField`,
`ClauseList`, the error summary, the attempt cookie, and the 30 MB rule.

**Top of the page, outside `<form>`, in this order:**

1. **Signed-in note**, only when a customer session cookie is present (`getSessionCookie()`):
   `<p role="note" className="b2b-auth__notice">`
   - PL: "Ta przeglądarka jest zalogowana na Twoje konto. Reklamacja złożona tutaj będzie reklamacją
     gościa i nie pojawi się na koncie. **Złóż ją z konta**"
   - EN: "You're signed in to your account in this browser. A complaint filed here is a guest
     complaint and won't appear in your account. **File it from your account instead**"
   - The link goes to `/returns/new?origin=elsewhere`. It is a note, not a warning: continuing is
     legitimate (G6). A neutral notice, not error colours *(Selective Attention: not alarm styling for
     a non-error)*.
2. **Verified strip**, one line:
   - PL: "Składasz reklamację jako gość · **{email}** <span class="b2b-badge">✓ Zweryfikowany</span> · *Użyj innego adresu*"
   - EN: "Filing as a guest · **{email}** ✓ Verified · *Use a different address*"
   - *Użyj innego adresu* is `<button form="guest-leave" class="b2b-stacked__add">` (F-16). The ✓ is
     an `aria-hidden` icon. The word carries the meaning, not the colour.
3. `h1` reuses `returns.elsewhere.heading`. The intro has a guest variant:
   - PL: "Opisz produkt i zakup. Potwierdzenie, odpowiedzi i link do śledzenia reklamacji wyślemy na
     {email}."
   - EN: "Tell us about the product and the purchase. The confirmation, our replies and the link to
     follow your complaint go to {email}."
   - No *← Choose an order instead* link: a guest has no orders.

**Section *Contact and return address* in guest mode.**
- **No `<details>` summary.** 180 collapses this section because it is prefilled; a guest has nothing
  prefilled, so the fields are open *(Tesler: the summary pattern only pays when there is something to
  summarise)*.
- **The 180 hint "changes stay here"** (`returns.elsewhere.changesStayHere`) is not rendered: there is
  no account to protect.
- **E-mail as locked text, not an input.** The section's first row:

  ```
  E-mail                       (span.b2b-stacked__label, id=guest-email-label)
  anna@example.com  [✓ Zweryfikowany]          (p aria-labelledby=guest-email-label)
  Tego adresu nie można tu zmienić – na niego wysyłamy wszystko o reklamacji.
  This address can't be changed here; it's where we send everything about the complaint.
  ```

  Not `<input disabled>`, which is skipped by Tab, low-contrast and not posted. Not `<input readOnly>`
  either: it looks editable and invites a futile attempt *(Law of Similarity: do not style the
  non-interactive like the interactive)*. The way to change the address is the strip's *Use a
  different address*. Nothing posts `contact.email` (F-4).
- **Name\*, phone and the return address** are empty: no prefill (FR-031, US1 scenario 5). The
  address fields are `AddressFields` as in 180. The recipient name gets no default.
- **Actions.** The primary is *Submit complaint* (`returns.elsewhere.submit`) with the pending state.
  *Cancel* is ghost and goes to `/`.

**States** (beyond 180's, which carry over unchanged):

| State | Rendering |
| --- | --- |
| No guest session cookie, or G5 `401` | `303` to `/returns/guest` (the address prefilled from F-7's cookie when present) |
| G5 `403` (setting off mid-flow) | The page is replaced by the S-1 *disabled* notice. Nothing is created |
| Submit `401` (session expired) | F-14 |
| `RETURN_GUEST_LIMIT_REACHED` `cases_per_session` | Error summary: "W tej sesji złożono już największą możliwą liczbę reklamacji. Poproś o nowy link, aby złożyć kolejną." / "This session has filed as many complaints as it can. Request a new link to file another." It links to `/returns/guest` |
| `… cases_per_address` | "Z tego adresu złożono dziś największą możliwą liczbę reklamacji. Spróbuj jutro albo skontaktuj się z nami." / "This address has filed as many complaints as it can today. Try again tomorrow or contact us." |
| `429 RATE_LIMITED` | "Zbyt wiele prób. Spróbuj ponownie za kilka minut." / "Too many attempts. Try again in a few minutes." Answers kept |
| Honeypot hit | The success page as for a real case (G7) |
| Double submit | `submissionKey`: the repeat lands on the same success page (F-8) |
| No JS | 180's no-JS path, posting to `/returns/guest/submit` |

**Accessibility.** Focus order is note link → *Use a different address* → the form's fields in 180's
order → *Submit*. The error summary is 180's (`role="alert"`, `tabIndex={-1}`, focused first).

### S-6. Success: `/returns/guest/submitted/[ref]` (US1 scenario 6, FR-036, FR-045)

```
h1  Reklamacja {reference} przyjęta                          Complaint {reference} received
p   Potwierdzenie z linkiem do reklamacji wysłaliśmy na      We've sent a confirmation with the link to
    {email}. Odpowiemy na ten sam adres.                     your complaint to {email}. We'll reply to
                                                             that address.
section.b2b-stacked__card
  h2  Twój link do reklamacji                                Your complaint link
  p   Pod tym linkiem sprawdzisz status, odpowiesz na        Use it to check the status, answer our
      nasze pytania i dodasz pliki. Nie masz konta,          questions and add files. You don't have an
      więc zachowaj go – na przykład w zakładkach.           account, so keep it, e.g. as a bookmark.
  p role=note  Każdy, kto ma ten link, zobaczy tę            Anyone with this link can see this
               reklamację. Nie przekazuj go innym.           complaint. Don't share it.
  label "Link" + <input readOnly value={url} id=track-url    (selectable; onFocus selects all, JS)
                  class="w-full font-mono text-[13px]">
  [ Kopiuj link ]  btn--primary  (client leaf, rendered after hydration)     [ Copy link ]
  span role=status (mounted empty)  → "Skopiowano link." / "Link copied."
  a.btn.btn--outline  Otwórz stronę reklamacji (plain <a>, F-2)               Open the complaint page
footer row
  a  Złóż kolejną reklamację  (only while the session lives)                  File another complaint
  <form post /returns/guest/leave> [ Gotowe – zakończ sesję ] btn--ghost      Done – end session
```

**Decisions.**
- **The confirmation is the `<h1>`** (F-15). The reference is printed as returned (`#3F9A21C0`):
  eight characters need no chunking *(Miller)*. No processing time is promised (FR-036, 180 FR-B37).
  The confirmation sentence is unconditional, because the guest confirmation cannot be switched off
  (`confirmationEmailEnabled: true`, FR-045).
- **Copy link is the one primary action.** Keeping the link is the single thing that matters at this
  ending *(Peak-End, Von Restorff)*.
- **The link is shown in a read-only input** as well as behind the button, against R-5's "behind a
  Copy link button, not as text to read":
  - without JS the input is the only way to take the link;
  - on mobile, long-press select in an input works where the clipboard API may not *(Postel)*;
  - it is a single line that scrolls, so the 210 characters do not break the layout.
- **Copy failure** (Safari without permission, an old browser): the status says "Nie udało się
  skopiować. Zaznacz link i skopiuj go ręcznie." / "Couldn't copy. Select the link and copy it
  yourself." The input is focused and selected.
- **The copy leaf.** No storefront copy primitive exists. `ComparisonTable.tsx:300-322` has an inline
  copy handler. Lift that pattern into a small `CopyField` client leaf (input id, labels) beside the
  returns components, not a site-wide primitive. Its `copied` state should persist rather than revert
  after 1.5 s, as the compare share button does: a screen-reader user needs the result to stay.
- **"Anyone with this link…"** is stated here as well as on the tracking page (FR-041). The moment of
  receiving the link is when sharing it is decided.
- **The four actions** are under Hick's ceiling. *End session* is ghost and last *(Serial Position:
  the rarely needed exit at the end)*.

**States.**

| State | Rendering |
| --- | --- |
| Flash cookie matches `ref` | as above |
| No cookie, or `ref` mismatch | `303` to `/returns/guest` (F-8) |
| Guest session already ended or expired | *File another complaint* is not rendered |
| No JS | No *Copy link* button; the input and the open link remain |

### S-7. Tracking page: `/returns/track/[token]` (US2, FR-040–FR-043)

Headers are `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex` (F-5). There are no analytics
scripts (F-2). Every outbound link has `rel="noreferrer"`.

**Layout.** The account case page's order and markup, through F-12's shared sections *(Similarity:
the same case looks the same whoever opens it)*:

```
h1  Reklamacja {reference}   (or rmaNumber; reuse returns.case.title.complaint)
p.b2b-stacked__meta  [Status: Przyjęta]  ·  <span class=b2b-badge>Kupione gdzie indziej</span>
p role=note .b2b-auth__notice
    Każdy, kto ma ten link, może zobaczyć tę reklamację      Anyone with this link can see this
    i dodać do niej wiadomość. Nie przekazuj go innym.       complaint and add messages to it. Don't
                                                             share it.
[closed only] p.b2b-auth__notice
    Reklamacja jest zamknięta. Strona będzie dostępna        This complaint is closed. This page stays
    do {date}; nie można już dodawać wiadomości ani          available until {date}; messages and files
    plików. Pytania? Skontaktuj się z nami.                  can no longer be added. Questions? Contact us.
[O-1, rejected] p.b2b-auth__notice  Powód odrzucenia: {reason}
section Produkty          (CaseItems: name × qty, reason, serial, description; no image previews)
section pair  Zakup | Kontakt i adres zwrotny  ("Tak, jak podano w tej reklamacji.")
section#files  Pliki  (icon tiles, download via /returns/track/<token>/files/<id>)
    [open] add-file form, as on the account page: type select, FilePicker, btn--outline "Prześlij"
section#conversation  Rozmowa
    comments: "Sklep" / "Ty" · date · body       empty: account.return.noMessages
    [open] textarea "Dodaj wiadomość" (required, maxLength 2000) + btn--primary "Wyślij"
```

**Decisions.**
- **The "anyone with this link" note sits at the top, every visit** (FR-041). It is `role="note"`,
  not an alert: it is information, not an error *(Selective Attention: no promo or alarm styling)*.
- **A closed case** replaces both forms with the closed notice and gives the expiry date from
  `linkValidUntil`, formatted in the locale. Read-only is explained, not silently enforced (ux-laws §6
  *Disabled: explain why*). While the case is open, `linkValidUntil` is `null` and nothing about
  expiry is shown *(Occam)*.
- **One primary per view.** *Send* is the primary. *Upload* is outline (180 R-3.5). The file form
  carries no line selector beyond 180's *Concerns* select, which maps `lineIndex`.
- **No cancel action** (spec Assumptions). The guest asks in a comment.
- **Result lines after a `303`** (F-15). `?comment=added#conversation`:
  - added: "Wiadomość wysłana." / "Message sent.";
  - `comments_per_case`: "Dziś wysłano już wiele wiadomości. Poczekaj na naszą odpowiedź albo spróbuj
    jutro." / "Many messages have been sent today. Wait for our reply or try again tomorrow.";
  - `429`: the S-1 sentence;
  - `409 case_terminal`: "Reklamacja została w międzyczasie zamknięta – nie można już nic dodać." /
    "The complaint was closed in the meantime; nothing more can be added.";
  - files: 180's `returns.attachments.*` sentences under `#files`.

**States.**
- **Open**: comment and file forms. **Closed**: read-only with the date.
- **Empty**: *no messages* and *no files* lines.
- **File budget**: "7 z 10 plików" / "7 of 10 files", as 180.
- **Results**: comment and file accepted or refused.
- **Invalid, erased or replaced**: the neutral page (S-8).
- **Module off**: the generic not-found (F-6).
- **No JS**: every form posts to its route handler.

**Accessibility.** Focus order is h1 → note → contact link (closed) → file links → file form →
textarea → *Send*. The textarea has a visible `<label>`. Download links name the file and its type,
so the link text is unique (WCAG 2.4.4).

### S-8. Neutral invalid link (`app/returns/track/[token]/not-found.tsx`, FR-043, SC-007)

```
h1  Ten link nie działa                                       This link doesn't work
p   Link do reklamacji mógł wygasnąć albo zostać              The complaint link may have expired or
    zastąpiony nowym. Jeśli masz od nas nowszą                been replaced by a new one. If you have a
    wiadomość, użyj linku z niej.                             newer e-mail from us, use the link in it.
p   Potrzebujesz pomocy? Skontaktuj się z nami.               Need help? Contact us.
```

- It is a `.b2b-auth` card, with HTTP `404`, `noindex` and `no-referrer`.
- The page is one page for every cause: mistyped, guessed, expired, replaced or erased. It never
  says "complaint not found" or "data erased", and nothing on it depends on the token (SC-007).
- It has no form. A guest cannot request a tracking link themselves (*resend my links* is out of
  scope), so the contact page is the honest next step *(Peak-End: an exit, not a dead end)*.

---

## Part 3: admin issues

### A-1. Focus in the guest-action confirmations (`ReturnDetail.tsx:1023-1054`): real, and a shared admin-kit fix

**It is real, not a jsdom artefact.** The sequence in a browser:

1. `RowActionMenuItem` `onSelect` → `setAsking('erase')`. Radix closes the menu in the same event.
2. One commit unmounts the menu and mounts `ConfirmDialog`. `useFocusTrap`'s effect focuses *Cancel*
   (`destructive`), and records `previous = document.activeElement`. That is `<body>`, because the
   focused menu item has just been removed.
3. Radix `FocusScope` dispatches its unmount auto-focus in a `setTimeout(0)`
   (`@radix-ui/react-focus-scope` `dist/index.mjs:89`). In a browser it runs **later** still, after
   the content's `animate-out` exit animation. `DropdownMenu`'s default `onCloseAutoFocus`
   (`@radix-ui/react-dropdown-menu` `dist/index.mjs:113-117`) then focuses the ⋮ **trigger**.

The result:
- Focus leaves the modal for a control behind the scrim. The trap's Tab handler is bound to the panel,
  so Tab no longer cycles inside the dialog. WCAG 2.4.3 and 2.1.2 (the modal's contract) fail.
- Enter now reopens the menu instead of answering the question. The destructive dialog's "open on
  *Cancel*" protection is defeated.
- Closing the dialog returns focus to `previous = <body>`, so the keyboard user loses their place.

`product_feeds` (`ProductFeedsListPage.tsx:268-284`, `useConfirmDialog` from `onSelect`) has the same
sequence, and so does every consumer that opens a dialog from a `RowActionMenuItem`. Ten files use the
item.

**The fix belongs in `packages/admin-kit/src/components/RowActionMenu.tsx`**, once:

```tsx
// RowActionMenu: a trigger ref and a deferred action, shared with its items through context.
const triggerRef = useRef<HTMLButtonElement>(null);
const deferred = useRef<(() => void) | null>(null);
<DropdownMenuTrigger asChild><Button ref={triggerRef} …/></DropdownMenuTrigger>
<DropdownMenuContent
  align="end"
  onCloseAutoFocus={(event) => {
    const run = deferred.current;
    if (!run) return;               // plain close: Radix's own trigger focus
    deferred.current = null;
    event.preventDefault();         // composeEventHandlers then skips Radix's default
    triggerRef.current?.focus();    // the dialog's trap now records the trigger as the opener
    run();                          // opens the dialog after the menu has let go of focus
  }}
>
// RowActionMenuItem: onSelect={() => (ctx ? (ctx.deferred.current = onSelect) : onSelect())}
```

**Why this order works.**
- The dialog mounts only after the menu has finished closing, so no timer can take focus back.
- Its trap focuses *Cancel* (destructive) or the confirm button.
- Its trap records the trigger as `previous`, so *Cancel*, Escape or a finished action return focus to
  ⋮ (WCAG 2.4.3).
- The delay is one frame plus the exit animation, under the Doherty threshold.
- `asChild` navigation items have no `onSelect` and are untouched.

**Do not** fix it in `ReturnDetail` with `finalFocusRef` or a `setTimeout`. A `setTimeout(0)` queued in
the select handler runs *before* Radix's (queued later, at unmount), so the steal still happens. A
per-module fix would also leave `product_feeds` and the other eight consumers broken.

**Tests.**
- In admin-kit: open the menu, select an item whose handler mounts `<ConfirmDialog destructive>`,
  flush timers, assert `document.activeElement` is *Cancel*; press Escape and assert it is the ⋮
  trigger.
- Re-run `admin/test/modules/returns/ReturnDetail.guest.test.tsx` and the `product_feeds` list tests.
  A test that asserts a synchronous effect right after selecting an item now needs `act` plus a timer
  flush, which is the honest behaviour.
- `DropdownMenu` used directly with a dialog (outside `RowActionMenu`) keeps the bug. A grep for
  `DropdownMenuItem` call sites that open a dialog belongs in the same change's description, not in
  this review.

### A-2. The admin list search should send `q`: yes

`ReturnsList.tsx:93` sends the box's text as `rmaNumber`, a substring match on the RMA number only
(`return-list-service.ts:135`). `q` (`return-list-service.ts:136-149`) is a strict superset:
- RMA substring;
- an order id when the term is one;
- the derived reference (`#3F9A21C0`);
- the contact e-mail, exact, case-insensitive.

With `rmaNumber`, FR-061's "find guest cases by the contact e-mail address" and US4 scenario 3 (erasure
on a data-subject request) cannot be done from the screen. Neither can the D-4 reference lookup that
180 added for cases without an RMA number.

**Change.**
- `p.set('q', …)` instead of `rmaNumber`. The export link (`:389`) uses the same `queryString`, so it
  follows.
- Rename the state from `rma` to `search`.
- Saved views:
  - write `{ q }`;
  - on `applyView`, read `f.q ?? f.rmaNumber`, so a view saved under 180 keeps finding what it found.
    `q` matches the RMA number with the same `%…%` rule.
- Filter chip: "Szukaj: {q}" / "Search: {q}".
- `aria-label`: "Szukaj zwrotów i reklamacji" / "Search returns and complaints". It is a search box
  now, not an RMA field.
- Add `aria-hidden="true"` to the `Search` icon (`:414`).

**Placeholder.** It says exactly what the box matches, and that the e-mail must be whole: a partial
address finds nothing, by design (R-10), and an operator typing `anna@` would otherwise conclude there
is no case.
- PL: **"Numer RMA, numer zgłoszenia lub pełny e-mail"**
- EN: **"RMA number, case reference or full e-mail"**

The order id is left out: no operator types a uuid. Put the text in the module's own bundle
(`packages/modules/returns/i18n/{en,pl}.json`, `list.search.placeholder`). That key exists but is unused,
and its current text "RMA number, order, customer" is wrong: neither customer names nor order numbers
are matched. Retire the shared `_i18n` keys `returns.search.placeholder` and `returns.filter.rmaNumber`
if nothing else reads them.

---

## States covered

| Surface | States |
| --- | --- |
| Entry (S-1) | signed out and enabled; enabled off (redirect to login); signed in (redirect); module off (not found); malformed address; `429`; disabled mid-flow; session-expired return; prefilled; no JS |
| Sent (S-2) | with and without the cookie; resend inside and after 60 s, with JS and without; throttled, honeypot and send failure identical; `429` |
| *Continue* (S-3) | pending; double click (F-3); missing token; no JS; scanner GET |
| No longer works (S-4) | prefilled and empty; setting off |
| Guest form (S-5) | signed-in note; verified strip; no session; setting off; session expired at submit; both guest limits; `429`; honeypot; double submit; every 180 state unchanged |
| Success (S-6) | cookie match and mismatch; session live and ended; copy success and failure; no JS |
| Tracking (S-7) | open and closed; rejected (O-1); empty conversation and no files; file budget; comment and file results; comment limit; closed mid-flow; module off; no JS |
| Neutral (S-8) | every invalid cause, one page |
| Admin (A-1, A-2) | focus on open, Escape and close; legacy saved view with `rmaNumber`; e-mail exact match and partial miss |

## What this review did not do, and what needs a human decision

**Not done.**
- No production code.
- No edits to spec, plan, tasks or contracts.
- No contrast measurements: every colour named is an existing token or kit variant.
- F-1 is **unverified**: the dev storefront on `:3000` answered `503` throughout, so the layout-versus-page
  redirect order is reasoned from the code, not observed.

**Human decisions.**
1. **O-1**: add `rejectionReason` to the guest view (recommended) or show a fixed "sent by e-mail"
   sentence.
2. **O-2**: "any live guest session continues to the form" instead of "the same verification"
   (recommended), or a backend comparison on G3.
3. **O-3**: the new-link offer prefilled when this browser knows the address, empty otherwise
   (recommended), instead of "the same address" everywhere.
4. A follow-up only, not for this feature: exchanging the tracking token for a cookie and a clean URL
   (F-2's cleaner option), if the owner wants the token out of the address bar too.
