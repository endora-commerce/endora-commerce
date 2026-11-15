---
'@endora-commerce/mod-crm': minor
---

CRM analytics count days and months in the reporting time zone (issue #474): the
`analytics.reporting_time_zone` setting the `analytics` module owns, read through its
`reportingTimeZonePort`. A range runs from midnight of its first day to midnight after its last,
both in that zone, and the month a won opportunity is ranked in is that zone's month. The setting
defaults to `UTC`, in which every figure is what it was before. While `analytics` is switched off
the figures are counted in `UTC`; the manifest declares the new `degrades-without` edge on
`analytics`.

Every `GET /api/v1/admin/crm/analytics/*` answer adds `timeZone`, the zone it was counted in
(issue #475), beside `data`. The analytics screen names that zone under its filters and takes the
range presets (*This month*, …) from that zone's calendar instead of the browser's.

Upgrading: an instance whose operator has set the reporting time zone to anything but `UTC` sees
CRM figures counted in that zone from this release on.
