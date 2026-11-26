/**
 * `@endora-commerce/test-kit/command-middleware` — what a module author needs
 * to test command middleware with the platform's own semantics
 * (`specs/189-command-middleware/` FR-040, `contracts/command-middleware-api.md`
 * §8, research R-17).
 *
 * There is no in-memory bus here, deliberately: a second implementation of the
 * ordering, gating and budgets is the drift the requirement exists to prevent,
 * and a double that skipped child Commands would reproduce the defect the
 * middleware point fixes. A test seals a real `CommandMiddlewareRegistry` and
 * hands it to a real `CommandBus` (`new CommandBus(orm, audit, events,
 * { middleware })`); every composition refusal is the platform's own, and
 * `registry.settled()` waits for the observers a run scheduled.
 */

import { AssertionError } from 'node:assert';
import {
  assertCommandMiddlewareRules,
  type CommandMiddlewareDeclaration,
  type ModuleManifest,
  type ModuleOrigin,
} from '@endora-commerce/contracts';
import {
  CommandRefusedError,
  type CommandAdmissionMeta,
  type CommandMiddlewareEntry,
  type CommandRunOutcome,
} from '@endora-commerce/platform/commands';
import { CommandMiddlewareRegistry } from '@endora-commerce/platform/composition';

export interface SealedCommandMiddlewareRegistryInput {
  /** The manifest declarations, as `commandMiddlewareFrom(manifests)` derives them. */
  readonly declarations: readonly (CommandMiddlewareDeclaration & { readonly moduleId: string })[];
  /** The registrations, per registering module, in registration order. */
  readonly middleware: readonly { readonly moduleId: string; readonly entries: readonly CommandMiddlewareEntry[] }[];
  /** Each module's transitive dependencies; defaults to none. */
  readonly moduleDependencies?: Readonly<Record<string, readonly string[]>>;
  /** Each module's derived origin; defaults to `'core'` for every module named above. */
  readonly origins?: Readonly<Record<string, ModuleOrigin>>;
  readonly commandMiddlewareOrder?: readonly string[];
  /** Presence per call; defaults to every module present. */
  readonly isPresent?: (moduleId: string) => boolean;
}

/** Logs nowhere: a test asserts on what it recorded, not on log lines. */
const SILENT = { info: (): void => undefined, warn: (): void => undefined, error: (): void => undefined };

/**
 * A command-middleware registry registered and sealed the way `composeModules`
 * seals the platform's, for a unit test that runs Commands on a real
 * `CommandBus` without composing the platform.
 */
export function sealedCommandMiddlewareRegistry(input: SealedCommandMiddlewareRegistryInput): CommandMiddlewareRegistry {
  const registry = new CommandMiddlewareRegistry({ log: SILENT, ...(input.isPresent ? { isPresent: input.isPresent } : {}) });
  for (const { moduleId, entries } of input.middleware) registry.register(moduleId, entries);
  const origins: Record<string, ModuleOrigin> = {};
  for (const declaration of input.declarations) origins[declaration.moduleId] = 'core';
  for (const { moduleId } of input.middleware) origins[moduleId] = 'core';
  registry.seal({
    declarations: input.declarations,
    moduleDependencies: input.moduleDependencies ?? {},
    origins: { ...origins, ...input.origins },
    commandMiddlewareOrder: input.commandMiddlewareOrder,
  });
  return registry;
}

export interface RecordingCommandMiddleware {
  /** Every Command an `admit` from this recorder was asked about, in order. */
  readonly admitted: CommandAdmissionMeta[];
  /** Every outcome an `observe` from this recorder received, in order. */
  readonly observed: CommandRunOutcome[];
  /** An `admit` entry that records, and refuses when `refuseWhen` answers a refusal. */
  admit(options?: {
    readonly id?: string;
    readonly refuseWhen?: (meta: CommandAdmissionMeta) => CommandRefusedError | undefined;
  }): Extract<CommandMiddlewareEntry, { phase: 'admit' }>;
  /** An `observe` entry that records. */
  observe(options?: { readonly id?: string }): Extract<CommandMiddlewareEntry, { phase: 'observe' }>;
}

/** A recorder whose entries are handed to `ctx.commandMiddleware` or to {@link sealedCommandMiddlewareRegistry}. */
export function recordingCommandMiddleware(): RecordingCommandMiddleware {
  const admitted: CommandAdmissionMeta[] = [];
  const observed: CommandRunOutcome[] = [];
  return {
    admitted,
    observed,
    admit(options = {}) {
      return {
        id: options.id ?? 'record-admit',
        phase: 'admit',
        admit: (meta) => {
          admitted.push(meta);
          const refusal = options.refuseWhen?.(meta);
          if (refusal !== undefined) throw refusal;
        },
      };
    },
    observe(options = {}) {
      return {
        id: options.id ?? 'record-observe',
        phase: 'observe',
        observe: (outcome) => {
          observed.push(outcome);
        },
      };
    },
  };
}

/**
 * Fail with composition's own message when `manifest`'s declarations and
 * `entries` disagree, when the declarations break the manifest rules
 * `defineModuleManifest` applies, or when a declared phase is not allowed for
 * `origin` (default `'core'`; an installed package is `'package'`, D-296.3).
 */
export function expectCommandMiddleware(
  manifest: Pick<ModuleManifest, 'id' | 'commandMiddleware' | 'errorCodes'>,
  entries: readonly CommandMiddlewareEntry[],
  options: { readonly origin?: ModuleOrigin } = {},
): void {
  try {
    assertCommandMiddlewareRules(manifest);
    sealedCommandMiddlewareRegistry({
      declarations: (manifest.commandMiddleware ?? []).map((declaration) => ({ ...declaration, moduleId: manifest.id })),
      middleware: [{ moduleId: manifest.id, entries }],
      origins: { [manifest.id]: options.origin ?? 'core' },
    });
  } catch (error: unknown) {
    throw new AssertionError({ message: `expectCommandMiddleware: ${error instanceof Error ? error.message : String(error)}` });
  }
}

/**
 * Fail unless `error` is a `CommandRefusedError` whose code `manifest`
 * declares in `errorCodes` — the author-side proof research R-5 (c) relies on,
 * since the bus does not check a refusal's code against a manifest at run time.
 */
export function expectDeclaredRefusal(error: unknown, manifest: Pick<ModuleManifest, 'id' | 'errorCodes'>): void {
  if (!(error instanceof CommandRefusedError)) {
    throw new AssertionError({
      message:
        `expectDeclaredRefusal: expected a CommandRefusedError from '${manifest.id}', got ` +
        `${error instanceof Error ? error.constructor.name : typeof error}.`,
    });
  }
  const declared = new Set((manifest.errorCodes ?? []).map((declaration) => declaration.code));
  if (!declared.has(error.code)) {
    throw new AssertionError({
      message:
        `expectDeclaredRefusal: '${manifest.id}' refuses with '${error.code}', which its manifest's ` +
        '`errorCodes` does not declare — declare it and translate it in pl and en (feature 090).',
    });
  }
}
