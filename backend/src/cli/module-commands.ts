/**
 * The host's side of a module-declared CLI command (feature 080, T042b /
 * D-160.9, D-157.8).
 *
 * ## What this file is, and what it is not
 *
 * It is the part of `src/cli.ts` that has no process in it: enumerate the
 * commands the resolved manifest set declares, find the one the operator named,
 * decide presence, build the module's context and invoke. `src/cli.ts` composes,
 * opens the scope and turns the answer into an exit code; everything decidable
 * without a database lives here so it can be driven from a test.
 *
 * It is **not** a second composition path. It receives `contextFor` from the
 * composition the host already built, so a command resolves the module's own
 * registrations — including any decoration a deployment applied over them,
 * which is the second reason D-157.1 gives for composing at all and the one the
 * hand-built scripts silently lost.
 *
 * ## Presence is decided here, once, and not per command
 *
 * Constitution XVII item 3 is explicit that a hand-placed presence check is the
 * shape to avoid: *"a gate the registration applies cannot be forgotten in the
 * one service somebody adds later, which a hand-placed call can and did."* A
 * command has no route to gate, no worker to wrap and no port resolution to
 * hang a transient gate on — it is exactly the case `requireModuleEnabled`
 * exists for. So the **declaration** is the seam: the host knows which module
 * declared the command it is about to run, and asks about that module, first,
 * before it builds a context and outside every `try`. A module author writes no
 * presence check and cannot forget one.
 *
 * That is D-157.5 applied at the one place that covers every command rather
 * than at each command: *"A composing module command asks it for **its own**
 * module id, after composition and outside every `try`. It never asks it for
 * the **owner's** id: that answer is the port gate's, and asking it twice is
 * how the two would come to disagree."* Both halves hold — the id asked about
 * is always the declaring module's, and a port the body resolves is gated by
 * its own owner's `providePort`.
 */
import type { ModuleCliCommand, ModuleManifest } from '@b2b/contracts';
import { MODULE_CLI_COMMAND_NAME_RE } from '@b2b/contracts';
import { requireModuleEnabled } from '../kernel/lifecycle/plugin-helpers.js';
import type { ModuleContext } from '../kernel/module-context.js';

/**
 * The minimum of a manifest entry this file reads.
 *
 * Structural rather than `RegisteredManifestEntry`, because the three origins
 * the platform resolves — core, this deployment's overlay and an installed
 * package — reach here as one array and none of them is more this file's
 * business than the others. That is D-157.8's *"one shape covers core, overlay
 * and package"* expressed as a parameter type.
 */
export interface CommandDeclaringEntry {
  readonly manifest: Pick<ModuleManifest, 'id'>;
  readonly cliCommands?: readonly ModuleCliCommand<never>[] | undefined;
}

/** One command, with the module that declared it. */
export interface DeclaredCommand {
  readonly moduleId: string;
  readonly name: string;
  readonly summary: string;
  readonly command: ModuleCliCommand<ModuleContext>;
}

/**
 * The `--help` text, answered from the declaration alone.
 *
 * Separate from {@link runModuleCommand} because the host answers it **before
 * it composes**: a tool has to be able to say what it does before it can do it,
 * and for `audit_logs read` that is D-102's condition rather than a nicety —
 * its credential is host access, not a working connection string.
 */
export function helpFor(command: DeclaredCommand): string {
  return command.command.help ?? `${command.moduleId} ${command.name} — ${command.summary}`;
}

/** A declaration the host refuses to advertise, with the reason. */
export class InvalidCommandDeclarationError extends Error {
  constructor(readonly moduleId: string, reason: string) {
    super(`[cli] module '${moduleId}' declares an invalid command: ${reason}`);
    this.name = 'InvalidCommandDeclarationError';
  }
}

/** The operator named a module or a command that is not declared here. */
export class UnknownCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownCommandError';
  }
}

/**
 * Every command the resolved manifest set declares, module id then command
 * name.
 *
 * Refuses rather than skips, in both directions a declaration can be wrong: a
 * name the addressing grammar cannot express, and two commands of one module
 * claiming one name. Skipping either would produce a command that `--list`
 * does not print and the runner cannot find, which is the failure mode D-157.8
 * rejected path-convention dispatch for — *"a resolution ladder whose failure
 * mode is 'command silently not found'"*.
 */
export function collectModuleCommands(
  entries: readonly CommandDeclaringEntry[],
): DeclaredCommand[] {
  const out: DeclaredCommand[] = [];
  for (const entry of entries) {
    const declared = entry.cliCommands ?? [];
    const seen = new Set<string>();
    for (const command of declared) {
      const moduleId = entry.manifest.id;
      if (!MODULE_CLI_COMMAND_NAME_RE.test(command.name)) {
        throw new InvalidCommandDeclarationError(
          moduleId,
          `'${command.name}' is not a command name. A command is addressed as ` +
            `'<module id> <command name>', so the name must be lowercase and ` +
            `hyphen-separated (${String(MODULE_CLI_COMMAND_NAME_RE)}).`,
        );
      }
      if (seen.has(command.name)) {
        throw new InvalidCommandDeclarationError(
          moduleId,
          `two commands named '${command.name}'. Which one runs would depend on ` +
            `declaration order.`,
        );
      }
      seen.add(command.name);
      out.push({
        moduleId,
        name: command.name,
        summary: command.summary,
        // The declaration is typed `ModuleCliCommand<never>` on the way in so
        // any module's `ModuleCliCommand<ModuleContext>` is assignable without
        // the entry types having to name a kernel type. The host supplies a
        // real `ModuleContext`, which is what the body was written against.
        command: command as unknown as ModuleCliCommand<ModuleContext>,
      });
    }
  }
  return out.sort((a, b) =>
    a.moduleId === b.moduleId
      ? a.name.localeCompare(b.name)
      : a.moduleId.localeCompare(b.moduleId),
  );
}

/** `--list` output: one line per command, aligned, for a human at a terminal. */
export function formatCommandList(commands: readonly DeclaredCommand[]): string {
  if (commands.length === 0) {
    return 'No module declares a CLI command in this composition.\n';
  }
  const addresses = commands.map((c) => `${c.moduleId} ${c.name}`);
  const width = Math.max(...addresses.map((a) => a.length));
  const lines = commands.map(
    (command, index) => `  ${(addresses[index] as string).padEnd(width)}  ${command.summary}`,
  );
  return `${lines.join('\n')}\n`;
}

/** The one command matching `<moduleId> <name>`. */
export function findModuleCommand(
  commands: readonly DeclaredCommand[],
  moduleId: string,
  name: string,
): DeclaredCommand {
  const found = commands.find((c) => c.moduleId === moduleId && c.name === name);
  if (found) return found;
  const ofModule = commands.filter((c) => c.moduleId === moduleId);
  if (ofModule.length === 0) {
    throw new UnknownCommandError(
      `[cli] no module '${moduleId}' declares a command in this composition. ` +
        `Run with --list to see every command this instance offers.`,
    );
  }
  throw new UnknownCommandError(
    `[cli] module '${moduleId}' declares no command '${name}'. It declares: ` +
      `${ofModule.map((c) => c.name).join(', ')}.`,
  );
}

export interface RunModuleCommandOptions {
  /** The resolved manifest set this composition was built from. */
  readonly entries: readonly CommandDeclaringEntry[];
  readonly moduleId: string;
  readonly name: string;
  /** Everything after `<module id> <command name>` on the host's argv. */
  readonly argv: readonly string[];
  /** The composition's own context factory — `ComposeAppHandle.contextFor`. */
  readonly contextFor: (moduleId: string) => ModuleContext;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * Find, gate and invoke — the whole of what the host does with a command.
 *
 * Nothing here is wrapped in a `try`. A failing command throws to `src/cli.ts`,
 * which reports it and exits non-zero, and that is the correct CLI behaviour
 * for every failure a command can have, `ModuleDisabledError` included
 * (D-157.3: *"a `.catch()` method on the entry promise is outside its
 * population by construction, so a `ModuleDisabledError` reaching it is
 * reported and exits non-zero"*).
 */
export async function runModuleCommand(options: RunModuleCommandOptions): Promise<number> {
  const declared = findModuleCommand(
    collectModuleCommands(options.entries),
    options.moduleId,
    options.name,
  );

  // Presence, before any work and before a context exists — see the file
  // header. It is asked about the **declaring** module, never about an owner
  // whose port the body resolves: that answer belongs to the owner's port gate.


  // Presence, before any work and before a context exists — see the file
  // header. It is asked about the **declaring** module, never about an owner
  // whose port the body resolves: that answer belongs to the owner's port gate.
  requireModuleEnabled(declared.moduleId);

  return declared.command.run({
    ctx: options.contextFor(declared.moduleId),
    argv: options.argv,
    out: options.out,
    err: options.err,
  });
}
