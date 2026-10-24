---
'@endora-commerce/mod-carts': patch
---

The admin and organization cart lists compute each cart's line count and total with one helper, `cartTotalsByCart`, which groups the lines by cart and sums each cart once, exactly (issue #417, review of PR #423). It replaces a running total folded through a synthetic line, copied in both services.
