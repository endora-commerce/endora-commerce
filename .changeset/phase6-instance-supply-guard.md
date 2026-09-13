---
'@endora-commerce/platform': patch
---

No published surface changes. The changeset records that
`check:port-dependencies` gained a third composition's question
(`instance-unsupplied`): a container name a module reads that no module
registers, no kernel source supplies, and `composeApp` does not register
either. It lands at zero.
