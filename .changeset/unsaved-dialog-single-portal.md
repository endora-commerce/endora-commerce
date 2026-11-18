---
'@endora-commerce/admin-kit': patch
---

`UnsavedChangesDialog` no longer wraps `ModalDialog` in a second portal: `ModalDialog` renders into `document.body` itself since DS-11 (#1444).
