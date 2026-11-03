---
'@endora-commerce/contracts': minor
---

One-click and default preferences by organization role (`specs/170-organization-roles/`, WP-06). Breaking for a caller that builds or switches on `PreferenceActor`:

- `PreferenceActor`'s `{ kind: 'org_admin'; organizationId }` becomes `{ kind: 'administrator'; organizationId }` — a member holding the Organization's *Administrator* role.
- `quickOrderOneClickEligibilitySchema`'s `reason` gains `permission_required` (the role lacks `quick_order.one_click`) and `cart_approval_required` (it holds that but lacks `carts.order_without_approval`), judged in that order before `setting_disabled`, `missing_defaults` and `ineligible_default`.
