---
'@endora-commerce/platform': patch
---

Keep the complete pre-065 migration identity and ownership inventory in the platform package. Deployments now project that immutable order onto the modules they install, so an extracted module can restore its historical migrations without reordering an existing database while free installations may omit that module.
