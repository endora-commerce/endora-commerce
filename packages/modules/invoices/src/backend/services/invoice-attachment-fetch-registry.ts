import type {
  InvoiceAttachmentFetchPort,
  InvoiceAttachmentFetchRegistration,
  InvoiceAttachmentFetchRegistryPort,
} from '@endora-commerce/contracts';

/**
 * The invoice-owned check that the attachment belongs to the calling
 * organization, answering the imported document's source system, or `null`.
 * `ErpSaleDocumentWritePortService.resolveAttachmentContext` in production.
 */
export type InvoiceAttachmentFetchContextResolver = (input: {
  invoiceId: string;
  attachmentId: string;
  organizationId: string;
}) => Promise<{ system: string } | null>;

/** Two different providers for one source system. */
export class InvoiceAttachmentFetchConflictError extends Error {
  constructor(system: string, existingModuleId: string, moduleId: string) {
    super(
      `invoiceAttachmentFetchRegistry: source system "${system}" already has a fetch provider ` +
        `from module "${existingModuleId}"; module "${moduleId}" cannot register a second one.`,
    );
    this.name = 'InvoiceAttachmentFetchConflictError';
  }
}

/**
 * The first-download seam for ERP-imported attachments (feature 134, T061;
 * `specs/134-paid-module-extraction/research.md` D12).
 *
 * `invoices` owns the customer route, the ownership check and what a first
 * download does. What it does not own is the remote system the bytes live in,
 * so a connector contributes a provider for the source system it imports from.
 * Before this seam the route resolved one connector's port by name and this
 * module's manifest carried an edge onto that connector.
 *
 * **A contribution registry in D-39's sense.** It is an ungated registration,
 * because a connector pushes into it from a boot hook whatever this module's
 * effective state is; the question of presence is answered here, on every
 * download, keyed on the module recorded with each provider.
 *
 * **The policy it states: skip an absent contributor's provider.** A connector
 * that is switched off must not reach its ERP with the operator's credentials,
 * so its provider answers as if it were not registered: `null`, which the route
 * turns into the 404 it already gave an attachment that could not be fetched.
 * Nothing is lost with the skip — a file fetched earlier is stored in
 * `assets_library` and the route serves it without asking any provider — and
 * switching the connector back on takes effect on the next download with no
 * restart, because nothing here is captured at composition.
 *
 * Three more rules, each stated because the alternative is plausible:
 *
 *  1. **Ownership is checked before any provider runs.** The context resolver
 *     is this module's own query, scoped to the calling organization, so a
 *     connector is never asked to fetch a foreign organization's file.
 *  2. **There is no fallback.** A document is answered by the provider of its
 *     own source system or by nobody; another connector's provider is never
 *     tried, whatever is present.
 *  3. **A second provider for one system is refused**, not ordered. Which
 *     provider serves a system must not depend on which module composed last.
 *     Registering the identical provider twice is accepted.
 */
export class InvoiceAttachmentFetchRegistry
  implements InvoiceAttachmentFetchRegistryPort, InvoiceAttachmentFetchPort
{
  private readonly registrations = new Map<string, InvoiceAttachmentFetchRegistration>();

  /**
   * @param resolveContext  the invoice-owned ownership check.
   * @param isModulePresent the effective-state probe. Defaults to
   *   always-present, so a registry a unit test builds keeps answering about
   *   the providers that test registered; the module's composition wires it to
   *   the kernel's effective state.
   */
  constructor(
    private readonly resolveContext: InvoiceAttachmentFetchContextResolver,
    private readonly isModulePresent: (moduleId: string) => boolean = () => true,
  ) {}

  register(registration: InvoiceAttachmentFetchRegistration): void {
    const existing = this.registrations.get(registration.system);
    if (existing) {
      if (
        existing.moduleId === registration.moduleId &&
        existing.provider === registration.provider
      ) {
        return;
      }
      throw new InvoiceAttachmentFetchConflictError(
        registration.system,
        existing.moduleId,
        registration.moduleId,
      );
    }
    this.registrations.set(registration.system, registration);
  }

  async ensureAttachmentBytes(input: {
    invoiceId: string;
    attachmentId: string;
    organizationId: string;
  }): Promise<{ assetId: string } | null> {
    const context = await this.resolveContext(input);
    if (!context) return null;

    const registration = this.registrations.get(context.system);
    if (!registration || !this.isModulePresent(registration.moduleId)) return null;

    return registration.provider.ensureAttachmentBytes(input);
  }
}
