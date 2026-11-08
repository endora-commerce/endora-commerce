---
'@endora-commerce/mod-audit-logs': patch
---

The audit viewer draws an erased value (`"[erased]"`) in a snapshot, and an erased IP address or user agent, as a translated *Erased* / *Usunięto* token, keeping every key of the snapshot; a string that merely starts with the marker is printed as typed. Recent activity reads the marker as absent, so a target name falls back to the live label or the id, and the compact summary leaves the erased key out. The `audit.redacted` action is labelled from this module's bundle. The module page documents the one exception to the append-only promise: erasure on anonymisation.
