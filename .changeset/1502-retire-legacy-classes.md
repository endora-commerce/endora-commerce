---
'@endora-commerce/admin-kit': minor
'@endora-commerce/cli': patch
---

`@endora-commerce/admin-kit` theme: the second card system and the legacy form, table and layout classes are removed from `theme.css` (issue #1502, UX audit SHELL-18). **Breaking for a theme or a module that renders or overrides these classes (0.x, so released as a minor).** Nothing in the platform renders them any more: issue #1492 moved their last renderers onto the kit.

Upgrade note — replace each removed class with its kit primitive (`@endora-commerce/admin-kit/ui`) or Tailwind utility:

- `.b2b-card`, `.b2b-card__head`, `.b2b-card__title`, `.b2b-card__sub`, `.b2b-card__body`, `.b2b-card__foot`: `Card`, `CardHeader`, `CardTitle` (an `h2`; `as` picks another level), `CardDescription`, `CardContent`, `CardFooter`. `CardContent` pads all four sides unless it follows a `CardHeader`, so do not add `pt-6`.
- `.b2b-card__body--flush`: `<Card flush>` around a table.
- `.b2b-card--clickable`: a `Card` with a `Link` inside it.
- `.b2b-btn`, `.b2b-btn--primary`, `.b2b-btn--default`, `.b2b-btn--ghost`, `.b2b-btn--sm`, `.b2b-btn--lg`: `Button` (default variant), `variant="outline"`, `variant="ghost"`, `size="sm"`, `size="lg"`.
- `.b2b-field` (input or textarea), `.b2b-select`, `.b2b-label`, `.b2b-help`: `Input`, `Textarea`, `Select`, and `FormField` for the label and the hint.
- `.b2b-field--addon` and `.b2b-input-wrap` (a search box with a leading icon): `ListToolbarSearch` from `@endora-commerce/admin-kit`.
- `.b2b-tbl`: `Table`, `TableHeader`, `TableRow`, `TableHead`, `TableCell`.
- `.b2b-row`, `.b2b-col`, `.b2b-mono`: `flex items-center gap-3`, `flex flex-col gap-2`, `font-mono`.

A theme that overrode one of these classes in its stylesheet now overrides nothing; move the override to the kit primitive's tokens (`--card-pad`, `--fs-section-title`, `--r-*`, `--primary-*`) or to a still-published class such as `.b2b-badge`. The badge, tabs, page frame and drawer/scrim classes stay.

`@endora-commerce/cli`: `endora new module --admin` scaffolds its screen's card as `<CardContent>` without the `pt-6` workaround, which drew 24 px of top padding above 16 px sides.
