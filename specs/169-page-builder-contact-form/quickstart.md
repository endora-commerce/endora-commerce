# Quickstart: feature 169

How to see each item working on a local stack once its work package is merged. Neutral example data
only (`example.com`, `Acme`).

## 0. Prerequisites

```bash
pnpm run build:packages
pnpm run dev          # backend :3000, admin :3001, storefront :3002 (or your own ports)
```

An SMTP catcher is optional: with no `SMTP_URL` the platform's console driver logs every message
(the delivery record says `logged`).

## 1. Carousel arrows kept when every slide fits (WP-A)

1. Admin → CMS → Pages → a page → add **Content slider** with two slides and *Slides per view* 3.
2. Controls → *Keep the arrows when all slides fit* on. Publish.
3. Storefront: both arrows visible, inactive (not clickable), on a light and on a dark section.
4. Turn the option off: the controls disappear as before.

## 2. Empty listings (WP-A)

1. Add **Product slider** with *Source: category* pointing at an empty category, and a heading.
2. Editor: the note "No products in this category …" is shown.
3. Storefront: nothing at all is rendered for the block (inspect: no `cmsc-pb-product-grid__empty`).

## 3. Accordion Filled and download tile icon (WP-A)

- Accordion → *Item style: Filled* — title bars on the section's muted surface, also on a dark section.
- Download tile → *Link look: Round icon button* → *Icon size: Large*, *Icon style: Filled* — a
  ~112 px filled circle with the glyph inverted.

## 4. Page navigation (WP-B)

1. Give three Sections the anchors `about`, `offer`, `contact`.
2. Add **Page navigation** at the top; items *About → #about*, *Offer → #offer*, *Contact →
   #contact* (picked from the anchor list); *Look: Pill*; *Sticky* on.
3. Storefront: click an item — smooth scroll (instant with reduced motion), the section's top is
   not under the bar; scrolling highlights the item in view; with JavaScript disabled the links
   still jump.

## 5. Contact form (WP-C)

1. Admin → Settings → *Contact form* → *Contact form recipients*: `sales@example.com` for all
   channels (or override per channel). ⌘K → "Contact form settings" opens the same screen.
2. A page: a Row with a Heading + lead in one column and **Contact form** in the other; turn on
   *Phone*, *Company* and *Choice* (options *North*, *South*); set the privacy consent label with a
   link to the privacy page; turn on the marketing consent; *Columns: 2*.
3. Optional: put the form and a **Newsletter sign-up** in two tabs of a **Tabs** block.
4. Storefront: submit. The backend log (console driver) shows one message to
   `sales@example.com`, `Reply-To` the address typed, subject "New message from the contact form —
   <channel>". The block shows its success message.
5. Tick the marketing consent with the newsletter on: the address appears in Newsletter →
   Subscribers (pending under double opt-in).
6. Try without JavaScript: the page reloads at the block with the outcome.
7. Remove the recipients: submitting shows the error message; the API answers
   `409 CMS_CONTACT_FORM_UNAVAILABLE`.

```bash
curl -s -X POST http://localhost:3000/api/v1/storefront/cms/contact-form \
  -H 'content-type: application/json' -H 'x-sales-channel: default' \
  -d '{"email":"jane@example.com","message":"Hello","privacyConsent":true}'
# → {"data":{"status":"sent"}}
```

**Deployment note**: the rate limit is per client IP. Behind the reference storefront, set
`TRUSTED_PROXY_ADDRESSES` (or `TRUSTED_PROXY_HOPS`) so the backend reads the shopper's IP from
`X-Forwarded-For`; otherwise every shopper shares the storefront's limit.

## 6. Newsletter sign-up topics and attributes (WP-D)

1. Newsletter → Tags: `b2b` "Trade news"; Newsletter → Custom fields: `company` (text),
   `consent_phone` (boolean).
2. A page → **Newsletter sign-up** → Topics → pick *Trade news* from the list; Attributes → add
   `company` (label "Company", required) and `consent_phone`.
3. Storefront: subscribe; the subscriber carries tag `b2b` and the custom-field values. Leave
   *Company* empty: the form refuses it with a translated message.
