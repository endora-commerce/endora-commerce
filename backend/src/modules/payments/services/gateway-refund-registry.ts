import type {
  PaymentRefundInput,
  PaymentRefundResult,
} from '../../returns/ports/payment-refund.port.js';

/**
 * GatewayRefundRegistry (feature 049) — the generic seam through which a PSP
 * vendor module (e.g. Stripe) fulfils refunds for `kind === 'gateway'` payments.
 *
 * Mirrors the PaymentAdapterRegistry pattern: a vendor module imports this
 * process-wide singleton and registers its refund handler from its boot hook,
 * so the platform has exactly one table of handlers however many times it is
 * composed. `PaymentRefundProvider` consults it for gateway payments and falls
 * back to `pending_manual` when no handler answers — keeping the `payments` and
 * `returns` modules provider-agnostic.
 *
 * **Every entry names the module that contributed it (feature 074, FR-024).**
 * This is a contribution registry in D-39's sense: the push is ungated — a boot
 * hook runs whatever the contributing module's effective state is, and gating
 * the push would make a deactivation survive as a permanently missing entry —
 * so the presence question is answered *here*, at enumeration, keyed on the
 * owner recorded with the entry. Until this shipped the registry recorded no
 * owner and stated no policy, and D-44 §7 named it the one live instance of
 * that gap: a switched-off gateway went on refunding through its own PSP API.
 *
 * **The policy this registry states: an absent owner's handler is skipped.**
 * `get`, `resolve` and `list` answer as if it were not registered; `entry`,
 * `ownerOf` and `listAll` deliberately do not filter, because a settlement
 * screen has to keep showing the handler *and* the reason it is unavailable.
 * Three things decide it, and the money is on the other side of each:
 *
 *  1. A module that is off must not act. Refunding through a PSP the operator
 *    switched off charges that PSP's API with that operator's credentials —
 *    the opposite of "behaves as if never installed" (Principle XVII).
 *  2. **The obligation is not dropped with the handler.** Skipping lands on
 *    `PaymentRefundProvider`'s existing `pending_manual` answer, which is what
 *    a deployment that never installed the gateway already gets: the refund
 *    stays on the platform's books, named, for a person to settle. That is why
 *    "a refund is an obligation we may already have incurred" is an argument
 *    for *recording* it, not for honouring the entry.
 *  3. {@link resolve} answers with the sole registered handler when the order
 *    names no adapter. Honouring an absent owner would route exactly those
 *    refunds — the ones with the least information behind them — into a
 *    switched-off gateway.
 *
 * Feature 075's Phase P published a structurally identical `GatewayRefundHandler`
 * in `@b2b/contracts`, and this declaration deliberately stays where it is
 * until Phase C: it is written against the two shapes `returns` declares, and
 * pointing it at the package would remove a cross-module import — which is a
 * cut, and a P-MR that cuts is no longer additive
 * (contracts/port-publication.md §1.6). The gateways satisfy both structurally,
 * so nothing waits on it.
 */
export interface GatewayRefundHandler {
  /** The payment adapter key this handler serves (e.g. `stripe`). */
  readonly adapterKey: string;
  refund(input: PaymentRefundInput): Promise<PaymentRefundResult>;
}

export interface RegistryLogger {
  warn(message: string): void;
}

const consoleLogger: RegistryLogger = {
  warn: (message) => console.warn(message),
};

/** One contributed handler, with the module that contributed it. */
export interface GatewayRefundEntry {
  readonly handler: GatewayRefundHandler;
  readonly module: string;
}

export class GatewayRefundRegistry {
  private readonly handlers = new Map<string, GatewayRefundEntry>();

  /**
   * @param log             collision warnings.
   * @param isModulePresent the effective-state probe. Defaults to
   *   always-present, so a registry a unit test builds for itself keeps
   *   answering about the handlers that test registered; the process singleton
   *   wires it to the kernel's effective state.
   */
  constructor(
    private readonly log: RegistryLogger = consoleLogger,
    private readonly isModulePresent: (moduleId: string) => boolean = () => true,
  ) {}

  register(handler: GatewayRefundHandler, moduleId: string): void {
    const existing = this.handlers.get(handler.adapterKey);
    if (existing && existing.module !== moduleId) {
      this.log.warn(
        `GatewayRefundRegistry: handler "${handler.adapterKey}" re-registered by module ` +
          `"${moduleId}" (was "${existing.module}"); overwriting previous registration.`,
      );
    }
    this.handlers.set(handler.adapterKey, { handler, module: moduleId });
  }

  unregister(adapterKey: string): void {
    this.handlers.delete(adapterKey);
  }

  /** The contributed entry, presence-blind. Diagnostics read this. */
  entry(adapterKey: string): GatewayRefundEntry | undefined {
    return this.handlers.get(adapterKey);
  }

  /** The module that contributed `adapterKey`, or `null` when nobody did. */
  ownerOf(adapterKey: string): string | null {
    return this.handlers.get(adapterKey)?.module ?? null;
  }

  /** The handler, or `undefined` when unregistered or its owner is absent. */
  get(adapterKey: string): GatewayRefundHandler | undefined {
    const entry = this.handlers.get(adapterKey);
    if (!entry || !this.isModulePresent(entry.module)) return undefined;
    return entry.handler;
  }

  /**
   * Resolve the handler for a gateway payment.
   * - Known `adapterKey` → exact handler only (never guess another PSP).
   * - Missing key → sole registered handler when exactly one exists.
   *
   * Both arms drop a handler whose owner is absent, and the second arm counts
   * only the handlers that are available: with one gateway installed and
   * switched off, "the sole registered handler" must not be it.
   */
  resolve(adapterKey?: string | null): GatewayRefundHandler | undefined {
    if (adapterKey) {
      return this.get(adapterKey);
    }
    const available = this.list();
    const [only, ...rest] = available;
    if (only !== undefined && rest.length === 0) return this.get(only);
    return undefined;
  }

  /** Adapter keys whose owner is present (stable insertion order). */
  list(): string[] {
    return [...this.handlers.entries()]
      .filter(([, entry]) => this.isModulePresent(entry.module))
      .map(([key]) => key);
  }

  /** Every registered adapter key, presence-blind. */
  listAll(): string[] {
    return [...this.handlers.keys()];
  }
}
