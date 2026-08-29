---
'@endora-commerce/contracts': minor
---

Publish `ModuleCliCommand` — a fourth export a module's `manifest.ts` may
declare, beside `installHook`, `uninstallHook` and `lifecycleParticipant`,
carried on `ModuleManifestExports.cliCommands`.

A module's operator command is now a **declaration the host runs**, never a
script that bootstraps the host. That is one-to-one with Magento 2, where a
module ships a command class plus a declaration under `CommandListInterface` and
`bin/magento` bootstraps the application and constructs the command with its
dependencies injected. It is what a packaged module needs: a file under
`node_modules` can name no specifier that resolves to the instance's
composition root, so a package could otherwise ship no operator command at all.

```ts
// <module>/manifest.ts
export const cliCommands: ReadonlyArray<ModuleCliCommand<ModuleContext>> = [
  {
    name: 'reindex',
    summary: "Rebuild every sales channel's index.",
    help: 'usage: search reindex',
    run: async (context) => (await import('./cli/reindex.js')).reindex(context),
  },
];
```

`ModuleCliCommandContext<Ctx>` carries `{ ctx, argv, out, err }`. `ctx` is the
module's own `ModuleContext`, generic for the same reason `EntityManager` is
generic on the lifecycle hooks — this package does not import kernel types — and
a handler resolves from it exactly as `backend.ts` does. `out` and `err` are
injected rather than reached for, so a command is drivable from a test without
capturing the process's streams. `run` returns the exit code; it is required to
return one, because a command that means "1" and returns nothing is
indistinguishable from one that succeeded.

`name` must match `MODULE_CLI_COMMAND_NAME_RE` (lowercase, hyphen-separated),
which is also exported: a command is addressed as `<module id> <command name>`,
so a name the grammar cannot express is unreachable and the host refuses it
rather than advertising it. `help` is an optional **data** property, answered by
the host before it composes — a tool has to be able to say what it does before
it can do it, and one of the shipped commands has that as a ruled condition
rather than a nicety. An optional data property is outside what D-97.3 refuses,
which is about optional **methods** on a published port.

The field is spelled `cliCommands`, not `commands`, so it cannot be read as a
Command Bus Command: `commands/` is already a module's directory of audited
domain writes. A CLI command that performs one runs it, resolved from `ctx`.

Additive: no existing export changed shape, `ModuleManifestExports` gained a
third optional generic parameter defaulting to `unknown`, and a `manifest.ts`
that declares no command is unaffected.
