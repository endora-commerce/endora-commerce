/**
 * Re-export shim — the host's side of a module-declared CLI command, at the
 * path its consumers already name.
 *
 * The sources are `@endora-commerce/platform`'s since
 * `specs/110-instance-repository/` T117 (FR-013, R7.1): enumerating the
 * commands a resolved manifest set declares, refusing a declaration the
 * addressing grammar cannot express, deciding presence from the **declaring**
 * module and invoking the body is the platform's logic, and a client's copy of
 * it is a copy that diverges the first time we correct ours. It moved whole —
 * it names no path in the tree that installs the platform, and the manifest
 * entries and the composition's `contextFor` are both parameters — so there is
 * no application binding here, only this forward.
 *
 * **The specifier is bare**, so it resolves in a client instance exactly as it
 * does here and is not a `RELATIVE_HOST_REACHES` reach — R7.3's line between a
 * shim that is progress and one that is the defect renamed. `./cli` is
 * host-internal (D-160.14): declared by the `exports` map, carried by no
 * published barrel, and named by no module.
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
} from '@endora-commerce/platform/cli';
