---
'@endora-commerce/mod-import-export': patch
---

The products import on the Import / Export screen now shows which step the operator is on: "Step n of 3" above a numbered *Profile*, *Check file* and *Apply* list, the current step marked `aria-current="step"` (issue #1528). A **Manage profiles** link sits next to the profile select and opens the **Import profiles** section, which is now collapsed by default. With no profile yet, **Create a profile** opens the create dialog. If the profiles cannot be loaded, step 1 says so and offers a retry, instead of "no profile yet". Dry-run and apply results appear in a polite status region beside the import, not in a success banner. A failed Apply is shown next to Apply, and the checked file stays there for a retry. The one-shot import of the other entity types reports its success the same way, beside its button; a file that is rolled back still shows a warning banner with its row errors.
