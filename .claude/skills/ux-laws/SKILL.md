---
name: "ux-laws"
description: "Laws of UX (lawsofux.com) as actionable frontend coding rules. Use when designing, generating, reviewing or auditing any UI — components, layouts, forms, navigation or user flows — in the admin panel or the storefront."
argument-hint: "Optional: the surface to design or audit (e.g. 'checkout step 2', 'PLP filters')"
compatibility: "Framework-agnostic; examples assume React 19 + Tailwind 4, matching admin/ and storefront/."
metadata:
  source: "https://lawsofux.com/"
user-invocable: true
---

# Laws of UX — working rules for UI code

This is the reference the `endora-commerce-designer` subagent applies. When you create,
modify or review a UI component, a page layout or a user flow, follow these rules and name
the law behind every non-obvious decision.

Two hard framing rules before anything else:

- **A law is a lens, not a proof.** Cite it to explain a decision; never use it to override a
  measured result, an accessibility requirement, or an explicit product requirement.
- **Repository conventions win over generic advice.** Reuse the existing primitives and
  tokens (see § Applying this in this repository) instead of inventing a parallel design
  language. Constitution IX (UI reuse) is binding.

---

## 1. Decision & interaction laws

### Jakob's Law
> Users spend most of their time on other sites, so they prefer your site to work the same way
> as every other site they already know.

- Keep the conventional commerce layout: logo top-left links to `/`, cart icon top-right,
  search in the header, breadcrumbs above the title, the primary action bottom-right of a
  form or bottom-centre on mobile.
- Do not reinvent native or well-known controls. Extend `select`, `dialog`, tabs, accordions
  and date inputs; do not build a bespoke replacement for the sake of it.
- When you must break a convention, say so explicitly in the handoff and explain the payoff.

### Fitts's Law
> Time to acquire a target is a function of the distance to and the size of the target.

- Touch targets are **at least 44×44 px** on mobile. Where the visual chrome is smaller, grow
  the hit area with padding or a pseudo-element, not by inflating the visible box.
- Expand the interactive region to its natural boundary: wrap checkboxes and radios in a
  `<label>` so the whole row is clickable; make the entire product card a link surface with
  nested actions stopping propagation.
- Put the primary action where the finger already is: sticky bottom bars on mobile PDP and
  checkout, primary action last in reading order on desktop.
- Destructive actions get distance, not proximity — never adjacent to a high-frequency
  primary action.

### Hick's Law
> The time to make a decision grows with the number and complexity of the choices.

- Cap a view at **3–5 primary actions**. Everything else is secondary, in an overflow menu,
  or on another step.
- Use progressive disclosure: accordions, tabs, "advanced options" sections, and drawers.
- Split long forms into steps rather than one wall of fields — especially checkout.
- Applies to merchandising too: a filter panel with 40 open facets is a Hick's Law failure;
  collapse to the top facets with a "show more".

### Choice Overload
> People get overwhelmed when presented with a large number of options.

- Give a recommended default (preselected shipping method, default variant, "most popular"
  tier) so the user can complete the task without evaluating everything.
- Sort and group options by likely relevance instead of alphabetically-by-accident.

### Miller's Law & Chunking
> Working memory holds about 7 (± 2) items.

- Group content into meaningful chunks: order summary, delivery, payment — not one flat list.
- Auto-format data the user must read back: order numbers, phone numbers, IBANs, card numbers,
  NIP/VAT identifiers, dates. `123 456 789` beats `123456789`.
- Keep a navigation group or a `select` at 5–7 items before introducing sub-grouping.

### Tesler's Law (Conservation of Complexity)
> Every system has an irreducible amount of complexity. The only question is who absorbs it.

- The system absorbs it, not the user: derive the city from the postcode, detect the card
  brand from the first digits, infer the country from the locale, pre-fill from the last
  order, resolve tax display mode from the organization rather than asking.
- If a step exists only because the backend finds it convenient, that is a design bug.

### Doherty Threshold
> Productivity soars when the interaction stays under ~400 ms.

- Respond to every interaction immediately, even before data arrives: optimistic UI for
  add-to-cart and quantity changes, skeletons for content, disabled+spinner for submits.
- Never leave a button in a plain state while a request is in flight — the user will
  double-submit.

### Postel's Law
> Be liberal in what you accept, conservative in what you send.

- Accept messy input and normalise it: phone numbers with spaces, dashes or `+48`; postcodes
  with or without the dash; NIP with or without separators; SKUs pasted with trailing
  whitespace; quantities pasted from a spreadsheet.
- Validate on blur or on submit, never on the first keystroke of an empty field.
- Search tolerates typos, diacritics-insensitivity and partial matches.

---

## 2. Perception & visual laws

### Von Restorff Effect (Isolation Effect)
> The element that differs from the rest is the one that gets remembered.

- **One primary CTA per view.** Everything else is `outline`, `secondary`, `ghost` or a plain
  link.
- Two competing filled buttons of the same colour cancel each other out — that is the single
  most common failure in generated commerce UI.
- Use the highlight budget deliberately: one "Most popular" tier, one "Best price" badge.

### Law of Proximity
> Objects that are near each other are perceived as a group.

- The gap between a `label` and its input must be **smaller** than the gap to the next field.
  If they are equal, the form reads as noise.
- Spacing communicates structure before any border does. Reach for whitespace first, a
  separator second, a card third.

### Law of Common Region
> Elements inside a shared, clearly bounded area are perceived as a group.

- Wrap a coherent unit (a cart line, an address, an order summary) in one card with a single
  padding value — do not fence individual fields inside it.

### Law of Similarity
> Visually similar elements are perceived as sharing a function.

- Same importance → identical radius, padding, weight and colour. If two things look the same
  they must behave the same.
- Never style a non-interactive element like a link or a button.

### Law of Uniform Connectedness
> Visually connected elements are perceived as more related than merely nearby ones.

- Connect the step indicator with a line, tie a total to its rows with a bounding rule, keep
  a variant swatch visually attached to the price it changes.

### Law of Prägnanz
> People interpret ambiguous images in the simplest form possible.

- Prefer the simplest layout that carries the information. Decorative complexity costs
  comprehension.

### Picture Superiority Effect
> Visual information is remembered far better than text alone.

- Pair destructive and frequent actions with a recognisable icon (`Trash2` for remove,
  `ShoppingCart` for add to cart) — icon **plus** label, never icon alone for a primary path.
- Empty states get an illustration or icon, a one-line explanation and one action — never a
  bare sentence.

### Selective Attention & Signal-to-Noise
> Users attend only to the subset of stimuli related to their goal, and filter out the rest.

- Anything that looks like an ad gets ignored (banner blindness). Do not style a genuine
  system message like a promo banner.
- Every element on screen either serves the current goal or competes with it.

---

## 3. Psychological & motivational laws

### Peak-End Rule
> People judge an experience by its peak and its ending, not the average.

- The order-confirmation screen is the ending of the entire purchase — treat it as a
  designed moment: clear confirmation, order number, what happens next, when it ships, and
  one obvious next action. Not a bare "Success".
- Error handling is the other peak. Error copy is specific, constructive and never blames the
  user: *"We couldn't reach the payment provider. Your cart is saved — try again."*, not
  *"Invalid request"*.
- Consider a restrained micro-animation on success. Restrained.

### Zeigarnik Effect
> Uncompleted tasks are remembered better than completed ones.

- Show progress for every multi-step process: "Step 2 of 4", a progress bar, "Profile 70%
  complete".
- Surface unfinished work on return: a saved cart, a draft quote request, an incomplete
  address.

### Goal-Gradient Effect
> Motivation increases with proximity to the goal.

- Show how close the goal is: "PLN 40 to free shipping", "2 of 3 documents uploaded". Give
  visible progress early rather than starting from zero.

### Serial Position Effect
> The first and last items in a series are the best remembered.

- Put the most important navigation entries and the most important actions first or last, not
  buried in the middle.

### Aesthetic-Usability Effect
> Aesthetically pleasing design is perceived as more usable.

- Visual polish buys tolerance for minor usability friction — it never substitutes for fixing
  it, and it can mask real problems in usability testing.

### Occam's Razor & Pareto Principle
> Prefer the solution with the fewest assumptions; ~80% of effects come from ~20% of causes.

- Remove elements until removing one more would break the task. Then stop.
- Optimise the paths users actually take (browse → PDP → cart → checkout) before polishing
  the long tail.

### Mental Model & Paradox of the Active User
> Users act on what they believe about the system, and they never read the manual.

- Match B2B vocabulary the buyer already has: "quote request", "net/gross", "payment terms",
  "delivery address" — not internal module names.
- Onboarding must be skippable and the interface understandable without it.

### Flow & Cognitive Load
> Cognitive load is the mental resource cost of using the interface.

- Do not interrupt a task in progress with a modal, a newsletter popup or a cookie re-prompt
  during checkout.
- Reduce extraneous load: fewer fields, sensible defaults, remembered choices, no jargon.

---

## 4. Accessibility floor (non-negotiable, WCAG 2.2 AA)

These are not laws of UX, but no design ships without them:

- Text contrast ≥ 4.5:1 (≥ 3:1 for large text and for UI component boundaries).
- Every interactive element is keyboard reachable, in a sensible tab order, with a visible
  focus ring (the repo's `focus-visible:ring-2 focus-visible:ring-ring` pattern).
- Colour is never the only carrier of meaning — pair it with an icon or text (stock status,
  validation state).
- Icon-only controls carry an `aria-label`; decorative imagery carries `aria-hidden="true"`.
- Form errors are programmatically linked (`aria-describedby`, `aria-invalid`) and announced.
- Respect `prefers-reduced-motion` for any animation — and drop the **motion**, not the
  **information**. A blanket `animation-iteration-count: 1 !important` guard freezes an
  informational animation into an ornament: measured on `.b2b-progress`, which becomes a static
  stripe indistinguishable from a decorative border, and on `.b2b-spin`, which becomes an arc.
- A status conveyed visually — loading, saving, a result count, a validation summary — has a
  programmatic equivalent in a live region (`role="status"` / `aria-live="polite"`), mounted
  **before** it has text, because a live region that arrives already carrying its message is not
  reliably announced. WCAG SC 4.1.3, level AA. **Axe cannot decide this**: it is a design-review
  obligation, and it reached this list through D-206 rather than through a tool.

---

## 5. Applying this in this repository

Reuse before you create (Constitution IX). The relevant primitives already exist:

| Need | Use |
| --- | --- |
| Admin buttons, inputs, cards, tables | `admin/src/components/ui/*` (shadcn/Radix + `cva` variants: `default`, `outline`, `secondary`, `ghost`, `destructive`, `link`) |
| Admin app chrome, nav, command palette | `admin/src/components/AppShell.tsx` |
| Admin sticky form actions | `admin/src/components/StickyFormActions.tsx`, `ui/save-button-group.tsx` |
| Charts | `<EChart>` — `admin/src/components/charts/echart.tsx` (Apache ECharts) |
| Storefront colours, radii, elevation, type | Tailwind 4 semantic tokens from `storefront/app/globals.css` `@theme inline`: `bg-surface`, `bg-surface-alt`, `text-fg`, `text-muted`, `text-subtle`, `border-line`, `border-line-strong`, `text-accent`, `*-ok`/`*-warn`/`*-bad` (+ `-soft`), `rounded-{sm,md,lg,xl}`, `shadow-{sm,md,lg}` |
| Storefront mobile reach (Fitts) | `components/mobile/MobileTabBar.tsx`, `PdpStickyBuyBar.tsx`, `BottomSheet.tsx`, `MobileFilterSheet.tsx` |
| Storefront commerce surfaces | `ProductCard`, `ProductGrid`, `FilterPanel`, `CartLine`, `CartTotals`, `components/checkout/*` |
| Storefront copy | `tForLocale(locale)` from `lib/i18n/messages.ts` — never a hard-coded literal |

Hard constraints that shape the design:

- **Never hard-code raw hex or arbitrary colours** in the storefront. Use the semantic tokens
  above so light/dark (`:root.is-dark`) and theme forks keep working.
- **All user-facing copy ships in `pl` and `en`.** A CI check rejects hard-coded literals.
- **Storefront pages stay SSR/SSG-capable** (Constitution VII). Default to Server Components;
  reach for `'use client'` only for genuine interactivity, and keep the client boundary as low
  in the tree as possible.
- **B2B reality**: prices have net/gross modes, catalogue visibility and prices are
  organization- and sales-channel-scoped, and some products show a quote-request CTA instead
  of a price. Design every price and buy surface for all of those states.
- Storefront component tests are **SSR-only** (`renderToString`, node env, no jsdom/RTL) —
  design so meaningful output is assertable from rendered markup, and put logic in pure
  exported functions.

---

## 6. Required states for every component

Never deliver only the happy path:

1. **Loading** — skeleton matching the final layout (no layout shift), or an inline spinner
   for actions.
2. **Empty** — icon/illustration + one-line explanation + one primary action.
3. **Error** — specific, constructive, actionable, and it never blames the user; a retry path.
4. **Partial / degraded** — out of stock, price unavailable, quote-only, over credit limit.
5. **Disabled / no permission** — explain why rather than silently hiding, where appropriate.
6. **Focus, hover, active, and `aria-busy`** for anything interactive.

---

## 7. Verification checklist

Run this over generated or reviewed UI before reporting done:

1. Exactly **one** primary CTA in the view; everything else is visually subordinate (Von
   Restorff).
2. Every touch target ≥ 44×44 px, and labels expand the hit area (Fitts).
3. ≤ 5 primary actions visible; the rest deferred via progressive disclosure (Hick).
4. Label→input spacing is tighter than field→field spacing; related content shares one
   bounded region (Proximity, Common Region).
5. Loading, empty, error and disabled states all exist (Peak-End, Doherty).
6. Layout follows conventional commerce patterns; no reinvented core control (Jakob).
7. Multi-step flows show progress (Zeigarnik); the goal distance is visible where one exists
   (Goal-Gradient).
8. Input is normalised, not rejected, wherever it reasonably can be (Postel).
9. Contrast, keyboard path, visible focus, `aria-label` on icon-only controls, non-colour-only
   status (WCAG 2.2 AA).
10. Only repo tokens and existing primitives — no new colours, no parallel button component,
    no hard-coded copy.
