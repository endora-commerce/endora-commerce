---
"@endora-commerce/mod-email": minor
---

`email` registers `emailBlockRendererRegistry`: the table a module registers its e-mail block renderers into (`register(ownerModuleId, renderers)` from `ctx.onBoot`). A name whose owner segment is not the registering module is refused and logged. `renderers()` leaves out the blocks of a module an operator switched off, read on every call, and honours an owner no manifest declares.
