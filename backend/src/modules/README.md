# Backend modules

Every business capability lives in its own subfolder here as a functionally independent module, per Principle I of the constitution.

- Folder names are **plural `snake_case`** (Principle VI). The only permitted singular exceptions are `auth/` and `example/`.
- Each module owns its own `entities/`, `migrations/`, `services/`, `routes.*.ts`, and local tests.
- Cross-module interaction goes through service ports or events emitted on the shared event bus — never through direct imports of another module's internals.
- Module folders are created by their corresponding tasks in `specs/001-b2b-platform-foundation/tasks.md`.

Reference: [`specs/001-b2b-platform-foundation/data-model.md`](../../../specs/001-b2b-platform-foundation/data-model.md) for the module inventory.
