---
'@endora-commerce/contracts': minor
---

`CustomFieldDefinitionReadPort` gains `getById(id)`, the committed-state read of a single
custom-field definition:

```ts
getById(id: string): Promise<CustomFieldDefinitionWithOptions | null>;
```

Consumers resolving the port under the container name `customFieldDefinitionReadPort` need no
change; the method is additive for them. It is the read `custom_fields`' **transactional apply
seam** used to answer, which was wrong twice over: an apply seam exists to take the caller's
`EntityManager`, and a read handed one is a write seam re-opened to serve a read; and the seam
returned the owner's two managed ORM entities, typed at the call site as records. `getById`
returns the published records.

`minor` rather than `major` because the only party that has to change is the port's **provider**,
and a port in this package has exactly one — the module that publishes it. If you implement
`CustomFieldDefinitionReadPort` yourself, add the method: it takes a definition id and answers
`null` when there is no such definition.
