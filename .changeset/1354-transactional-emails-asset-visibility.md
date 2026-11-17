---
'@endora-commerce/mod-transactional-emails': minor
---

**Breaking change:** `transactional_emails` now refuses a write that newly stores an asset id unless the administrator can see that file in the asset library. This covers a file that does not exist as well (issue #1354, the rest of #544). Before, these writes stored the id without checking it, so a file hidden from the administrator could be sent to every recipient.

The check applies to:

- E-mail content (`PUT /api/v1/admin/transactional-emails/:code/content`).
- E-mail block and e-mail template content (`PUT .../blocks/:id/content/:language`, `PUT .../templates/:id/content/:language`).
- The `transactional_emails.logo_asset_id` setting, set from the branding screen (`PUT .../branding`) or through the settings API.

Asset ids are read from string values under keys ending in `assetId`, the rule the e-mail renderer uses. A refused write answers `404 ASSET_NOT_FOUND` with `details.assetId` and stores nothing. A hidden file and a missing one get the same answer.

Ids the record already stores are not checked, so existing content saves as before. For e-mail content that means any id in the e-mail's default content or in any of its saved bodies, so a channel or language override that keeps the platform-wide images saves too.

**What to do:** an integration or import that writes e-mail bodies or the e-mail logo must use asset ids that exist. When it runs as an administrator, that administrator must be able to see the files in the library. The asset library documentation lists the new paths.
