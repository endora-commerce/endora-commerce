---
'@endora-commerce/mod-analytics': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-returns': patch
---

**Admin aggregates are narrowed to the organizations the administrator reaches.** The analytics
summary, and the "in use" count shown beside each order status and each return status, are
computed over organization-scoped data. They are now confined to the reader the way the lists
beside them already are, so an administrator whose authority is a set of organizations — a sales
representative — sees figures for those organizations only.

- A platform administrator sees what they saw before.
- An administrator confined to a set of organizations sees figures for those organizations, and
  one with no organization assigned sees none.
- Analytics events that belong to no organization — anonymous storefront traffic — are counted
  for a platform administrator and are not visible to an administrator confined to a set of
  organizations.

Upgrade to pick the change up; nothing in an instance has to be edited.

`AnalyticsQueryService.summary` takes an optional second argument, the organization constraint to
apply; it defaults to the one the ambient tenant context implies.
