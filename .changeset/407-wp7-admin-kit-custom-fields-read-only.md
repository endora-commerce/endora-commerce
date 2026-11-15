---
'@endora-commerce/admin-kit': minor
---

`CustomFieldValuesPanel` takes an optional `readOnly` prop (issue #407, `specs/180-one-save-zone-editors/` WP-7). With it, every field is shown as its value with no input, the way an `edit`-level definition is shown at `read`, and nothing reaches the bag. Without it the panel is unchanged. The organization detail uses it for an operator without `customers:manage`, whose page Save would never write the custom fields.
