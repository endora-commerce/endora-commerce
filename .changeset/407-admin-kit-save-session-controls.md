---
'@endora-commerce/admin-kit': minor
---

**`@endora-commerce/admin-kit/components`** adds the two generic controls for an editor's save session (issue #407, `specs/180-one-save-zone-editors/contracts/save-participation.md` §5):

- **`SaveSessionActions`** (`hostCount`, `canSave`, `saving`, `onSave`, optional `describedBy`). This is the one Save for a host that has no Save of its own. It renders inside `StickyFormActions` and reads "Save" or "Save n changes", counting the host's changes plus every participant's. It is inert while there is nothing to save or a save is running. It is shown when the host record or any participant is writable.
- **`SaveSessionSummary`** (`outcome`, `notices`, `onShow(partId)`). This renders a `SaveOutcome` part by part:
  - a refusal lists each part with its number of problems;
  - a partial save says what was saved and what was not, with the reason;
  - a failed save says nothing was saved;
  - a full save is announced in a polite live region only.
  Each part with a problem has a "Show" button, which calls `onShow`. Focus moves to the summary's heading when an outcome arrives. Discarded-change notices are listed below.

`CustomFieldValuesPanel` takes an optional `saveSession`. With one, the panel joins the page's one Save as a host-owned section and renders no Save button of its own. The page Save writes it through the host's `save`, and a refused write shows at the field. Without `saveSession`, the panel works exactly as before.
