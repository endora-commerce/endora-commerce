---
'@endora-commerce/mod-projects': minor
---

Every `GET /api/v1/admin/projects/analytics/*` answer adds `timeZone`, the reporting time zone its
days were counted in (`UTC` while `analytics` is switched off), beside `from`, `to`,
`projectCount` and `excluded` (issue #475). The analytics screen names that zone under its
filters and takes the range presets (*This month*, …) from that zone's calendar instead of the
browser's, so around midnight a preset means the days the figures are counted over.
