---
'@endora-commerce/admin-kit': minor
---

Publishes `CustomFieldValuesPanel` and `CustomFieldValuesPanelProps` on `./components`.

The panel renders the definition-driven form for one host record's custom fields
(feature 055). It was classified as a contribution the `custom_fields` module mounts
inside four other modules' screens, and `admin-component-contribution.md` §9.1 rules that
it never was one. Its props are `(entityType, values, save)` — data in, edited data back
— so all four call sites hand it the **host's own** stored bag and the **host's own**
writer, and `custom_fields`' admin API serves definitions and entity types and no values
at all. Principle XIV working as designed puts `customFieldValues` on the host's row, so
what crosses the seam is one `GET` for the definitions and nothing that belongs to the
owner.

That makes it the same shape as the pickers this package already publishes: it rebuilds
`GET /api/v1/admin/custom-fields/definitions?entityType=…` from the published
`apiClient`, and every type it names (`CustomFieldDefinitionDto`, `SupportedEntityType`)
is `@endora-commerce/contracts`', which both sides compile.

```diff
-import { CustomFieldValuesPanel } from '@/modules/custom_fields/CustomFieldValuesPanel';
+import { CustomFieldValuesPanel } from '@endora-commerce/admin-kit/components';
```

The admin keeps a re-export shim at the old path, so nothing outside the four consumers
had to be rewritten and both spellings are one binding — asserted by reference equality,
because a second copy would be a second `useState` draft of one record's values.

**It reads `core`, and adds no key to it.** `customFields.title` and `customFields.save`
were already in the shipped bundle in both languages, so R-1's rule about a translation
namespace being module knowledge is satisfied without moving anything. Rendered output is
unchanged.

**One defect travels with it, deliberately unfixed.** `defs.length === 0` returns `null`
**above** the error `Alert`, so a failed definitions load renders nothing and is
indistinguishable from "no custom fields are defined for this entity type". That is
accidentally right for a 503 and wrong for everything else. It predates this move and
repairing it inside a move would mix two subjects, so the behaviour is preserved verbatim
and asserted as it stands.
