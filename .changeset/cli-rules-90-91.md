---
'@endora-commerce/cli': patch
---

Two static-check rules under `@endora-commerce/cli/rules/*` read their subject more precisely.

- **`subscribe-seam`** (issue #90). A worker returned from an arrow function through a conditional,
  parentheses, an `as` assertion or a non-null assertion — `() => cond ? createXWorker() : null` —
  now counts as handed to the caller, both when the arrow is a worker factory and when it returns a
  factory's call. Before, only an arrow whose body was the call itself counted, so such a factory
  was reported as dropping its worker. A call that is only the condition of the conditional still
  does not count.
- **`port-shape`** (issue #91). Signal 2 now treats a documented `Container name:` that is in
  `PortShapeInput.platformOwnedNames` as registered, as signal 3 already did. A port doc that names
  a container the platform registers no longer gets a `container-name-unregistered` finding that no
  edit to the doc could clear.
