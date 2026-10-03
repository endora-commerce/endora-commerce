import {
  blockNameRe,
  type EmailBlockRendererRegistrationResult,
  type EmailBlockRendererRegistryPort,
} from '@endora-commerce/contracts';

/** The one method of a logger this registry uses, so a test hands it a spy. */
export interface EmailBlockRendererRegistryLog {
  warn(context: Record<string, unknown>, message: string): void;
}

interface Entry {
  readonly ownerModuleId: string;
  readonly renderer: unknown;
}

function isRenderer(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { html?: unknown }).html === 'function'
  );
}

/**
 * E-mail block renderers the composed modules contribute
 * (`specs/141-module-block-renderers/contracts/block-renderers.md` §5.3, §7).
 *
 * **Why `email` owns it.** It is the one module both e-mail producers —
 * `transactional_emails` and `newsletter` — already depend on, and it is
 * non-deactivatable, so a contributor's `dependencies: ['email']` costs it
 * nothing and the table can never be switched off under its contributors.
 * `newsletter` deliberately declares no edge to `transactional_emails`, and
 * tying the acknowledgement path to `cms` would let an operator's off-switch
 * reach it.
 *
 * **A contribution registry in D-39's sense**, and a plain `di.register`: a
 * contributor pushes from a boot hook whatever anybody's effective state is.
 *
 * **The policy it states: skip an absent contributor's renderer.** A block of
 * a module an operator switched off contributes nothing to an e-mail — the
 * same answer a block with no renderer at all gets — and the stored template
 * keeps the node and its props. Presence is read on every `renderers()` call,
 * so switching the module back on takes effect on the next render with no
 * restart. `listAll` stays presence-blind for diagnostics.
 *
 * **The probe is tri-state.** `undefined` — an id no manifest declares, which
 * is what an overlay module's id is — is honoured: collapsing "unknown" into
 * "absent" would remove the seam for exactly the modules that have no other.
 *
 * **The table does not interpret what it holds.** The renderer shape is
 * `@endora-commerce/email-components`' and this module does not depend on
 * that package; it checks that an entry has an `html` function, records who
 * offered it, and hands it back.
 */
export class EmailBlockRendererRegistry<R = unknown> implements EmailBlockRendererRegistryPort<R> {
  private readonly entries = new Map<string, Entry>();

  /**
   * @param presenceOf the effective-state probe. Defaults to "says nothing",
   *   so a registry a unit test builds answers about what that test
   *   registered; the module's composition wires the kernel's effective state.
   */
  constructor(
    private readonly presenceOf: (moduleId: string) => boolean | undefined = () => undefined,
    private readonly log?: EmailBlockRendererRegistryLog,
  ) {}

  register(
    ownerModuleId: string,
    renderers: Readonly<Record<string, R>>,
  ): EmailBlockRendererRegistrationResult {
    const registered: string[] = [];
    const refused: Array<{ name: string; reason: string }> = [];
    const refuse = (name: string, reason: string): void => {
      refused.push({ name, reason });
      this.log?.warn(
        { block: name, owner: ownerModuleId },
        `emailBlockRendererRegistry: module "${ownerModuleId}" offered a renderer for "${name}", which was refused — ${reason}`,
      );
    };

    for (const [name, renderer] of Object.entries(renderers ?? {})) {
      if (!blockNameRe.test(name) || name.slice(0, name.indexOf('.')) !== ownerModuleId) {
        refuse(
          name,
          `a block name is <module>.<Name> and a module renders only the blocks its own manifest declares`,
        );
        continue;
      }
      if (!isRenderer(renderer)) {
        refuse(name, 'the entry has no `html` function');
        continue;
      }
      this.entries.set(name, { ownerModuleId, renderer });
      registered.push(name);
    }
    return { registered, refused };
  }

  renderers(): Readonly<Record<string, R>> {
    // No prototype: the key is a name stored content chooses.
    const present = Object.create(null) as Record<string, R>;
    for (const [name, entry] of this.entries) {
      if (this.presenceOf(entry.ownerModuleId) === false) continue;
      present[name] = entry.renderer as R;
    }
    return present;
  }

  listAll(): ReadonlyArray<{ readonly name: string; readonly ownerModuleId: string }> {
    return [...this.entries].map(([name, entry]) => ({
      name,
      ownerModuleId: entry.ownerModuleId,
    }));
  }
}
