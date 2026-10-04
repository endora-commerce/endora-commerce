---
'@endora-commerce/cli': patch
---

The generated module reference pages give an operator command in the form an instance runs.
The **Operator commands** table read `pnpm --filter backend run cli -- <module> <command>`, which
is the form for a checkout of the Endora Commerce repository. In an instance the backend member
is named `<instance>-backend`, so that command matches no project: pnpm prints `No projects
matched the filters` and exits `0` without running anything. The table now reads
`pnpm run cli <module> <command>`, run in the root of the instance, and names the repository
form once above it.
