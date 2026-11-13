---
'@endora-commerce/mod-admin-roles': minor
---

The permission inventory scanner now reads host roots and admin-shell nav data (issue #1106).

- A scan root may be a host root, written `moduleId: null`, and may be marked as an Admin UI layer with `adminLayer: true`.
- In such a layer, every `hasPermission` / `hasAnyPermission` check is an `admin-control` site. The scanner also reads `requiredPermission:` data: a string literal is one code, and an array literal is one any-of site carrying every member.
- An object that also declares `element:` decides whether a route renders, so it stays an `enforcement` site.
