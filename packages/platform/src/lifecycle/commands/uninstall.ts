import { z } from 'zod';
import { LifecycleError } from '../services/orchestrator.js';
import { buildStaticRegistry } from '../services/static-registry.js';
import { orchestratorFor, type OperatorRuntime } from './operator-runtime.js';

/**
 * `module:uninstall <module-id> [--hard] [--force] [--json]` — the body
 * (`specs/115-lifecycle-container-move/`, D115-1).
 *
 * Soft uninstall (default): unregisters the module's settings, marks the
 * registry row as `uninstalled`, leaves DB tables / data intact.
 * Hard uninstall (`--hard`): also reverts the module's migrations and
 * deletes the registry row. `--hard` additionally requires `--force` on any run
 * that cannot ask the operator to confirm — which is every run whose caller
 * supplies no {@link OperatorRuntime.confirm} (D115-7, R2.7) — to prevent
 * accidental data loss in CI / cron.
 *
 * Exit codes (per `specs/018-module-lifecycle/contracts/cli-commands.md` §C-2),
 * preserved byte-for-byte by the move (R2.3):
 *   - 0   success (or already uninstalled — no-op)
 *   - 64  misuse: bad argv, --hard without --force on a run that cannot ask
 *   - 66  conflict: dependents still installed
 *   - 70  internal error during uninstall
 *   - 75  lock unavailable
 *   - 77  refused: the module declares itself non-deactivatable (D-69)
 */

const UninstallArgsSchema = z.object({
  id: z.string().regex(/^_?[a-z][a-z0-9_]*$/),
  hard: z.boolean().default(false),
  force: z.boolean().default(false),
  json: z.boolean().default(false),
});

type UninstallArgs = z.infer<typeof UninstallArgsSchema>;

function parseArgv(argv: readonly string[]): UninstallArgs | { error: string } {
  const positional: string[] = [];
  let hard = false;
  let force = false;
  let json = false;
  // Backward-compat aliases for the legacy modules:uninstall flags.
  for (const arg of argv) {
    if (arg === '--hard') hard = true;
    else if (arg === '--force') force = true;
    else if (arg === '--json') json = true;
    else if (arg === '--remove-settings') {
      hard = true;
      force = true;
    } else if (arg === '--preserve-settings') {
      // soft default — no-op flag, kept for back-compat
    } else if (arg.startsWith('--')) return { error: `unknown flag: ${arg}` };
    else positional.push(arg);
  }
  if (positional.length === 0) return { error: 'missing module id' };
  if (positional.length > 1) {
    return { error: `extra positional args: ${positional.slice(1).join(' ')}` };
  }
  const result = UninstallArgsSchema.safeParse({
    id: positional[0],
    hard,
    force,
    json,
  });
  if (!result.success) {
    return {
      error: `invalid argument: ${result.error.issues.map((i) => i.message).join('; ')}`,
    };
  }
  return result.data;
}

export async function runUninstallCommand(
  argv: readonly string[],
  rt: OperatorRuntime,
): Promise<number> {
  const parsed = parseArgv(argv);
  if ('error' in parsed) {
    rt.err(
      `usage: module:uninstall <module-id> [--hard] [--force] [--json]\n` +
        `error: ${parsed.error}\n`,
    );
    return 64;
  }
  const args = parsed;

  // Hard uninstall without --force requires a confirmation this run can
  // obtain, and whether it can is the *caller's* answer rather than this file's
  // (D115-7, R2.7). It used to be `!process.stdout.isTTY` here. That read is a
  // decision taken from a process global, which defeats R2.4's two reasons —
  // *testable without a process*, and *an instance may frame the output* —
  // exactly as writing to one would: a body test has to mutate a global to
  // reach this branch, and a deploy script, a systemd unit or an admin action
  // has its destructive-write policy decided by whether *its own* stdout
  // happens to be a terminal, which is a fact about the wrapper and not about
  // the operator. It was also wrong on its own terms — it tested stdout alone,
  // so `docker run -t`, a `script -qec` wrapper or any CI configuration that
  // allocates a terminal for coloured output read as interactive and took the
  // branch that **proceeds**, which is the mirror of the predicate
  // `specs/117-instance-bring-up/contracts/input-resolution.md` R3.5 refuses.
  //
  // The exit code and the sentence stay here, on this side of the partition
  // with the rest of the table (§1.1, R2.3); only the fact travels.
  //
  // **Absent means this run cannot ask**, and nothing supplies `confirm` today,
  // so the refusal is what every invocation meets. For the non-interactive runs
  // the CLI contract test and `uninstall-hard-needs-force.integration.test.ts`
  // spawn that is this branch's behaviour unchanged. Asking the question —
  // `specs/018-module-lifecycle/contracts/cli-commands.md` §C-2 step 6's *"or a
  // tty prompt confirming "yes" verbatim"*, which has never been implemented in
  // either tree — is `D-217`'s to settle, and the field is shaped so that either
  // of the owner's answers is a change to the entry points and to this branch,
  // never to the interface.
  if (args.hard && !args.force && !rt.confirm) {
    rt.err(
      `[uninstall] --hard requires --force unless this run can ask for confirmation ` +
        `(refusing to delete data without explicit confirmation).\n`,
    );
    return 64;
  }

  let registry;
  try {
    // The entries are the **instance-resolved** set (D-157.6a) — core, this
    // deployment's overlay modules and every installed Endora module package —
    // resolved by the entry point, which is where the collision refusal reaches
    // an operator (R2.2). The runtime carries no container, so a command cannot
    // compose the platform it operates on (D-157.2).
    registry = buildStaticRegistry(rt.entries);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    rt.err(`[manifest] ${msg}\n`);
    return 65;
  }

  // A platform command composes nothing (D-157.2), so the merged ownership a
  // composition root builds is not available to it: it answers for the committed
  // core registry and for nothing else, and a hard uninstall of a package module
  // is refused from the terminal rather than reverting core's rows and leaving the
  // package's behind. The map is read from the host's generated registry, which
  // is why it arrives on the runtime rather than being reached for here.
  const migrationOwnership = rt.migrationOwnership
    ? await rt.migrationOwnership()
    : undefined;

  const orchestrator = await orchestratorFor(
    rt,
    registry,
    migrationOwnership ? { migrationOwnership } : {},
  );

  try {
    const result = await orchestrator.uninstall(args.id, { hard: args.hard });
    if (args.json) {
      rt.out(JSON.stringify(result) + '\n');
    } else if (result.state === 'already-uninstalled') {
      rt.out(`[uninstall] ${args.id} — already uninstalled (no-op)\n`);
    } else if (args.hard) {
      rt.out(
        `[uninstall] ${args.id} --hard (DATA DELETED)\n` +
          `  ✓ uninstall hook completed\n` +
          `  ✓ settings removed: ${result.removedGroups} groups, ${result.removedSettings} settings\n` +
          `  ✓ migrations reverted: ${result.revertedMigrations.length === 0 ? '(none matched filename pattern)' : result.revertedMigrations.join(', ')}\n` +
          `  ✓ registry row deleted\n`,
      );
    } else {
      rt.out(
        `[uninstall] ${args.id} (soft, data preserved)\n` +
          `  ✓ uninstall hook completed\n` +
          `  ✓ settings unregistered: ${result.removedGroups} groups, ${result.removedSettings} settings (rows removed; tables intact)\n` +
          `  ✓ registry updated: state=uninstalled\n` +
          `re-installing re-uses the applied migrations, but not the configuration:\n` +
          `the settings above are gone; a re-install recreates them from the manifest defaults.\n` +
          `Use module:disable to pause a module without losing its configuration.\n`,
      );
    }
    return 0;
  } catch (err) {
    return mapError(err, args.json, rt);
  }
}

function mapError(err: unknown, asJson: boolean, rt: OperatorRuntime): number {
  if (err instanceof LifecycleError) {
    if (asJson) {
      rt.err(
        JSON.stringify({
          error: err.kind,
          message: err.message,
          ...err.details,
        }) + '\n',
      );
    } else {
      rt.err(`[uninstall] ${err.message}\n`);
      if (err.kind === 'non-deactivatable') {
        // Same hint the disable path prints, for the same reason: there is no
        // `--force` to suggest. The consequence of removing one of these is a
        // deployment that cannot authenticate the operator who would put it
        // back — and after `--hard` the tables that recovery needs are gone.
        rt.err(
          `hint: this module declares itself non-deactivatable in its manifest, which refuses ` +
            `uninstall as well as disable. If that declaration is wrong, change the manifest — ` +
            `there is no override flag.\n`,
        );
      }
    }
    switch (err.kind) {
      case 'unknown-module':
      case 'wrong-state':
        return 64;
      case 'manifest-cycle':
        return 65;
      case 'missing-deps':
      case 'dependents-block':
        return 66;
      case 'install-failed':
      case 'uninstall-failed':
        return 70;
      case 'lock-busy':
        return 75;
      case 'non-deactivatable':
        // EX_NOPERM — the request was well-formed and is not permitted.
        return 77;
    }
  }
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  rt.err(`[internal] ${msg}\n`);
  return 70;
}
