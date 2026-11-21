---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-newsletter': minor
---

The newsletter campaign editor asks for its settings before its content (issue #1533). Name, language, subject and audience share one *Settings* card above the e-mail canvas, which now has a card to itself. A single-tag audience is a group of radio buttons instead of checkboxes that behaved like one, and narrowing a tag list to a single tag keeps the first tag chosen. The manual group is a searchable picker (the admin kit's `MultiCombobox`) that shows the subscribers already in the group, including members who have since unsubscribed. Saving no longer rewrites a group nobody changed, and if the group cannot be read the picker is locked, so a save cannot empty it. The page-header *Preview* button and the preview card under the editor are gone: the builder's own *Preview email* dialog is the one preview, rendered in the campaign's language. "Saved" and the send results show beside the actions as a polite status instead of a banner. The automation builder uses the same radio group for a single-tag trigger, and shows its steps as one ordered list instead of a bordered box per step.

New in `@endora-commerce/contracts`: `campaignGroupMemberSchema` / `CampaignGroupMember` (`{ id, email }`) and `campaignGroupResponseSchema` / `CampaignGroupResponse` (`{ items }`), the response of the new `GET /api/v1/admin/newsletter/campaigns/:id/group` (permission `newsletter:read`). It returns the manual group's members ordered by e-mail and answers 404 for an unknown campaign.
