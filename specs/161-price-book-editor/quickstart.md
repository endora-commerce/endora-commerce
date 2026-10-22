# Quickstart — Price-book editor (feature 161)

## 1. Run it

```bash
pnpm run build:packages
pnpm run dev:infra
pnpm run setup                 # db:fresh + module:install --all (base books, precedence HY)
pnpm run cli demo reset        # demo books: E3 active, E1/E2 drafts (spec 160)
pnpm run dev                   # admin on Vite, backend on :3001
```

Open the admin, ⌘K → *Price books*.

## 2. Walk the owner's scenarios (SC-001)

1. ⌘K → *New price book*: regular, PLN, the demo channel, organizations → *Acme B2B (demo)*, save.
2. Grid → *Add products* → *Screws 0200*; *Add category* → *Screws*; type `-5%` in Screws 0200 "from
   1", `-15%` in Screws "from 1"; save.
3. ⌘K → *Price explainer*: Acme, Screws 0200, quantity 1 → **95.00**, *buyer*, *organization ×
   product*, runner-ups *Acme … Screws* 85.00 and *VIP … Screws 0200* 90.00 (E3.1).
4. Export the book, change a price in a spreadsheet, add a line with an unknown SKU, import (merge):
   the preview shows 1 change and 1 refused line; fix it; confirm; the grid equals the file (SC-009).

## 3. Manual measurements recorded at the end of Phase 12 (SC-002, SC-004)

- Paste 50 products × 3 tiers and save: time from paste to "saved" (target under 2 minutes end to end).
- Grid of 200 lines × 6 columns: DevTools Performance — keystroke-to-paint and arrow-key focus move
  under 100 ms; a 5 000-row save shows progress and the page stays interactive.
Record the numbers and the machine in `specs/161-price-book-editor/plan.md` *Measurements*.

## 4. Guards

```bash
pnpm --filter admin exec vitest run test/modules/price_lists test/kit/editable-grid.test.tsx
pnpm --filter backend exec vitest run test/contract/price_lists
pnpm --filter @endora-commerce/contracts exec vitest run test/price-book-decimal.unit.test.ts
pnpm --filter storefront exec vitest run test/catalog/list-price-pair.test.tsx
pnpm --filter backend run check:action-route-permissions
pnpm --filter backend exec vitest run test/unit/_i18n/registered-bundles-shape.test.ts
```
