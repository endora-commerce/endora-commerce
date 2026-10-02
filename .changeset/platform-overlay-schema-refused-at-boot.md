---
'@endora-commerce/platform': patch
---

An overlay module that ships schema now stops the process instead of being composed without it. A `migrations/` or `entities/` directory, or a source declaring an `@Entity()` class, under `apps/<deployment>/modules/<id>/` was refused only by `endora generate`; the API, the worker, the operator CLI and the `module:*` commands read entities and migrations from installed packages alone, so they never looked at it, no table existed, and nothing said so. They now exit with an error naming each file and the remedy before a module is composed or a database is opened. A bare `migrate` is not covered: it is handed no deployment root. If your instance boots today with such a directory, it will refuse to start after this upgrade — move the entity and its migration into a module package.
