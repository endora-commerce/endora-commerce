---
---

Storefront returns and complaints by organization permission (`specs/170-organization-roles/`, WP-14b, owner ruling OR-11). Only the `storefront` application changes, which is in the Changesets `ignore` list; no published package's emitted code moves. A member whose role lacks `returns.create` is offered no *Start a return* / *File a complaint* entry on the order detail and no *Start a new return* link, and `/returns/new` names the permission instead of the form; a holder of `returns.view_organization` sees a colleague's case marked *Filed by a colleague* in the list, and its detail is read-only (no message form, one line saying why, the filer's messages credited to *Colleague*), following Q-R2 = A.
