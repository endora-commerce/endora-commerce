---
'@endora-commerce/mod-quick-order': patch
---

**Every member of an Organization may read that Organization's default ordering preferences** (issue #359). `GET /api/v1/quick-order/preferences?scope=organization&scopeId=<own organization id>` used to answer `403 FORBIDDEN` to anyone but the Organization's *Administrator*, so a storefront could not say what a buyer's "use the organization default" stood for. It now answers `200` with the stored row (or `null`) for the caller's own Organization; another Organization's row is still refused. Writing the organization scope is unchanged and stays reserved to the *Administrator*. The rule is `canReadPreference` beside `canManagePreference` in the module's `default-preference-authz` service.
