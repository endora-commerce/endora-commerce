/**
 * `./cli` — the host's side of a module-declared operator command, and the
 * platform's thirteenth subpath (`specs/110-instance-repository/` T117,
 * FR-013).
 *
 * ## What is on it
 *
 * Everything a `pnpm --filter backend run cli` invocation decides **with no
 * process and no database**: the enumeration of every command the resolved
 * manifest set declares, the two refusals a declaration can earn, the
 * `<module id> <command name>` lookup, the `--list` and `--help` renderings,
 * and the find-gate-invoke that ends in the module's own `run`.
 *
 * ## What is *not* on it, and that is the shape of the move
 *
 * The process. `backend/src/cli.ts` reads `process.argv`, composes the
 * platform, opens one system scope over the composed container, disposes it and
 * turns the answer into an exit code — and it stays in the application because
 * every one of those is a fact about *this* deployment's entry point.
 * `specs/115-lifecycle-container-move/contracts/operator-half.md` §1.1 is the
 * partition it is judged by: *"a file belongs to `@endora-commerce/platform`
 * unless it names a path in the tree that installs the platform"*. This
 * directory names none — the resolved manifest entries and the composition's
 * own `contextFor` are both **parameters** — so it moved whole, with no
 * application binding left behind, which is the first file on this chain that
 * did (T113, T114 and T116 each split at least one).
 *
 * It is also **not** the `module:*` path and must never become one. Those five
 * operate *on* the platform rather than with it, compose nothing (D-157.2/.4)
 * and keep their own ~20-line entry points under `backend/src/lifecycle/` over
 * `@endora-commerce/platform/lifecycle`'s `commands/<verb>.ts` (R2.5).
 * `research.md` §3.1 calls this file *"the host's `module:*` dispatcher"*; it is
 * not, and `backend/src/cli.ts`' own header has said so since feature 080.
 *
 * ## Why no module may name it
 *
 * D-160.14's third state, for `./composition`'s own reason one surface over.
 * This is the code that decides **which** command runs and whether the module
 * that declared it is present at all — so a module that could name it could
 * enumerate its siblings' operator commands, and invoke one. A module declares
 * its commands in its own `manifest.ts` and receives a `ModuleContext`; that is
 * the whole of the surface it is entitled to. Declared by the `exports` map,
 * carried by no published barrel, and answered for a module's reach with
 * `host-internal-subpath`.
 *
 * The barrel names every symbol explicitly rather than re-exporting a
 * directory: `check:platform-surface` exits 2 on an `export *`, because a
 * wildcard makes the published set a property of whatever the files happen to
 * declare rather than of a decision anybody took.
 */

export {
  collectModuleCommands,
  findModuleCommand,
  formatCommandList,
  helpFor,
  InvalidCommandDeclarationError,
  runModuleCommand,
  UnknownCommandError,
  type CommandDeclaringEntry,
  type DeclaredCommand,
  type RunModuleCommandOptions,
} from './module-commands.js';
