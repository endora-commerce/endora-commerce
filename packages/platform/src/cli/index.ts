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
 * ## And the process around it, since `specs/123-oss-install-experience/` G2
 *
 * This header used to end *"the process — argv, the composition, the system
 * scope and the exit code — stays in the application at `backend/src/cli.ts`"*,
 * and the partition it cited is the reason it changed. `operator-half.md` §1.1:
 * *"a file belongs to `@endora-commerce/platform` unless it names a path in the
 * tree that installs the platform"*. The dispatch names none — the core
 * manifests, the composition and a tree's own demo composition are all
 * **parameters** — and the sentence was measured wrong the moment a second
 * application existed: `endora new instance` reported `backend/src/cli.ts` as an
 * omission, so a scaffolded instance could run **no** command its modules
 * declared, `admin_users create` included, and nobody could log in to it.
 *
 * What did not move is what genuinely names a path: this repository's generated
 * core index, its own `composeApp`, its `src/seeds/demo-composition.ts` probe,
 * and the one directory holding `apps/`. `backend/src/cli.ts` supplies those
 * four and is otherwise an exit code; a scaffolded instance supplies the last
 * one and is five lines. See `dispatch.ts`' own header.
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

export {
  cliFailureExitCode,
  cliUsage,
  DEFAULT_CLI_PROGRAM,
  dispatchCli,
  runCli,
  type CliComposition,
  type RunCliOptions,
} from './dispatch.js';
