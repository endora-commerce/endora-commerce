---
'@endora-commerce/mod-assets-library': patch
---

The retention sweep's previous-version pass no longer selects rows it cannot purge: a legacy
asset, or one whose kept previous version has no file locator. Before, such rows filled the
pass's batch ahead of the previous versions that really were due, which were then never
reached, and they kept the sweep's "is anything due?" question answering yes on every tick.
Which previous versions are kept and for how long does not change.
