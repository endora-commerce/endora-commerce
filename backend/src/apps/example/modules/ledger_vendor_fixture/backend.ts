import { timingSafeEqual } from 'node:crypto';
import {
  ERROR_CODES,
  type ConfigurationTypeRegistryPort,
  type CredentialsPort,
  type InvoiceCopyHostPort,
  type InvoiceKsefAssignmentPort,
  type InvoiceLedgerDeliveryPort,
  type InvoiceLedgerRegistryPort,
  type InvoiceLedgerVendorFreeze,
  type InvoiceLedgerVendorFreezeRegistryPort,
  type InvoiceLedgerWebhookPort,
  type InvoiceNumberingHostPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { ModuleContext } from '../../../../kernel/index.js';
import { lazyPort } from '../../../../kernel/index.js';
import { refusingLedgerFixtureHttp, type LedgerFixtureHttpPort } from './ports.js';
import {
  LEDGER_FIXTURE_CREDENTIAL_CODE,
  ledgerFixtureConfigurationType,
  resolveLedgerFixtureFreeze,
} from './services/credential.js';
import { bindLedgerFixtureDeliveryProcessor } from './services/delivery-processor.js';

/**
 * `ledger_vendor_fixture`'s composition — the four seams `invoice_ledger`
 * publishes for a vendor, and nothing else.
 *
 * Read `manifest.ts` first: it carries why this module exists. What is here is
 * how it joins, and every one of the four is a seam a free module owns and a
 * vendor reaches, so each is also the proof that the seam still compiles from the
 * consumer side:
 *
 *  1. **the vendor family** — declared in the manifest, derived by
 *     `declaredMembersOfCapability`. Nothing below does it;
 *  2. **the freeze registry** — a contribution seam (`di.register`, not
 *     `providePort`), pushed from `onBoot` keyed by this module's own id;
 *  3. **the mutex interceptor** — `POST /api/v1/admin/modules/:id/activation`,
 *     pre-phase, refusing when a sibling vendor is already active;
 *  4. **the delivery and webhook ports** — consumed by the processor and by the
 *     one route below.
 *
 * ## The boot hook contributes and does not probe
 *
 * D-67/D-68, the same rule `carrier_fixture` records: a hook that pushes an inert
 * descriptor into another module's registry must not ask whether its own module
 * is present. `credentials` and `invoice_ledger` both filter by contributor at
 * the read, so an operator's flip takes effect without a restart; a probe here
 * would make it need one.
 */

export const LEDGER_VENDOR_FIXTURE_MODULE_ID = 'ledger_vendor_fixture';

/** The one header the fixture's webhook authenticates with. No HMAC: see below. */
export const LEDGER_FIXTURE_WEBHOOK_SECRET_HEADER = 'x-ledger-fixture-secret';

interface LedgerFixtureCradle {
  readonly ledgerFixtureHttp: LedgerFixtureHttpPort;
  readonly ledgerFixtureDeliveryProcessor: ReturnType<typeof bindLedgerFixtureDeliveryProcessor>;
  readonly ledgerFixtureConnection: LedgerFixtureConnection;
}

/**
 * What the boot hook hands the freeze registry, and the reason it is a
 * registration rather than a closure written inside `onBoot`.
 *
 * `credentialsService` is a **gated** port, and a boot hook runs whatever the
 * owning module's effective state is — `runBootHooks()` does not consult
 * presence. So resolving it beside the contribution would let an operator
 * switching `credentials` off stop the next start, with the API down and the
 * screen they would undo it from unreachable; `check:port-dependencies` reports
 * exactly that, and it reads the resolution's **lexical position** rather than
 * when it runs. Registering the resolver moves the resolution into a factory the
 * container calls at use, which is the shape both real vendors already have
 * (`infakt`'s `infaktConnection`, `wfirma`'s `wfirmaConnection`).
 */
interface LedgerFixtureConnection {
  resolveEnqueueFreeze(salesChannelId: string | null): Promise<InvoiceLedgerVendorFreeze>;
  resolveWebhookSecret(): Promise<string | null>;
}

function headerString(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

function secretsMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    ledgerFixtureHttp: ctx.asFunction(() => refusingLedgerFixtureHttp()).singleton(),
    ledgerFixtureConnection: ctx
      .asFunction((): LedgerFixtureConnection => {
        const credentials = (): CredentialsPort =>
          lazyPort<CredentialsPort>(ctx, 'credentialsService');
        return {
          resolveEnqueueFreeze: (salesChannelId) =>
            resolveLedgerFixtureFreeze(credentials(), salesChannelId),
          resolveWebhookSecret: async () => {
            const resolved = await credentials().resolve(LEDGER_FIXTURE_CREDENTIAL_CODE);
            if (resolved.status !== 'ok') return null;
            const secret = resolved.values['webhookSecret'];
            return typeof secret === 'string' && secret.length > 0 ? secret : null;
          },
        };
      })
      .singleton(),
    ledgerFixtureDeliveryProcessor: ctx
      .asFunction(({ ledgerFixtureHttp }: LedgerFixtureCradle) =>
        bindLedgerFixtureDeliveryProcessor({
          deliveries: lazyPort<InvoiceLedgerDeliveryPort>(ctx, 'invoiceLedgerDeliveryPort'),
          invoiceCopy: lazyPort<InvoiceCopyHostPort>(ctx, 'invoiceCopyHostPort'),
          credentials: lazyPort<CredentialsPort>(ctx, 'credentialsService'),
          http: ledgerFixtureHttp,
          numbering: lazyPort<InvoiceNumberingHostPort>(ctx, 'invoiceNumberingHostPort'),
          ksefAssignment: lazyPort<InvoiceKsefAssignmentPort>(ctx, 'invoiceKsefAssignmentPort'),
        }),
      )
      .singleton(),
  });

  ctx.onBoot(() => {
    lazyPort<ConfigurationTypeRegistryPort>(ctx, 'configurationTypeRegistry').register(
      ledgerFixtureConfigurationType,
    );
    const cradle = ctx.cradle<LedgerFixtureCradle>();
    lazyPort<InvoiceLedgerVendorFreezeRegistryPort>(ctx, 'invoiceLedgerVendorFreezeRegistry')
      .register(
        LEDGER_VENDOR_FIXTURE_MODULE_ID,
        (salesChannelId) => cradle.ledgerFixtureConnection.resolveEnqueueFreeze(salesChannelId),
        LEDGER_VENDOR_FIXTURE_MODULE_ID,
      );
  });

  /**
   * The exclusive capability's enforcement, and it is each member's own.
   *
   * `invoice_ledger` mints the refusal and answers *"is a sibling active"*; the
   * interceptor that asks is the vendor's, because only the vendor knows which
   * activation request is about it. Both real vendors carry the identical block,
   * which is what makes this one the proof that the shape survives their removal.
   */
  ctx.interceptors([
    {
      id: 'refuse-when-sibling-ledger-vendor-active',
      target: 'POST /api/v1/admin/modules/:id/activation',
      phase: 'pre',
      handler: async (interceptorCtx: { params: unknown; body: unknown }): Promise<void> => {
        const { params, body } = interceptorCtx;
        const moduleId =
          params !== null && typeof params === 'object' && 'id' in params
            ? String((params as { id: unknown }).id)
            : '';
        const active =
          body !== null &&
          typeof body === 'object' &&
          'active' in body &&
          (body as { active: unknown }).active === true;
        if (moduleId !== LEDGER_VENDOR_FIXTURE_MODULE_ID || !active) return;
        await lazyPort<InvoiceLedgerRegistryPort>(
          ctx,
          'invoiceLedgerRegistryPort',
        ).assertCanActivate(LEDGER_VENDOR_FIXTURE_MODULE_ID);
      },
    },
  ]);

  /**
   * The vendor-side webhook ingress, which exists so that
   * `invoiceLedgerWebhookPort` keeps a caller in this workspace.
   *
   * **A shared secret, not an HMAC.** The signature scheme is the vendor's own —
   * `infakt` verifies `sha256` over the raw body, `wfirma` does something else —
   * and none of it is the free ledger's contract. Reproducing one of the two here
   * would put a paid vendor's scheme into a free file, which is the defect this
   * whole prologue exists to remove; inventing a third would be a fixture testing
   * itself. What the free ledger owns is what happens *after* authentication, and
   * that is the call below.
   */
  ctx.routes(async (app) => {
    app.post('/api/v1/integrations/ledger-vendor-fixture/webhook', async (request, reply) => {
      const stored = await ctx
        .cradle<LedgerFixtureCradle>()
        .ledgerFixtureConnection.resolveWebhookSecret();
      const received = headerString(request.headers[LEDGER_FIXTURE_WEBHOOK_SECRET_HEADER]);
      if (stored === null || !received || !secretsMatch(stored, received)) {
        throw new HttpError(
          401,
          ERROR_CODES.UNAUTHORIZED,
          'The ledger vendor fixture webhook secret is missing or invalid.',
        );
      }

      const body = (request.body ?? {}) as Record<string, unknown>;
      const asString = (key: string): string | null =>
        typeof body[key] === 'string' && body[key] !== '' ? (body[key] as string) : null;
      const eventId = asString('eventId');
      if (eventId === null) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'The ledger vendor fixture webhook event is missing a stable event id.',
        );
      }

      const result = await lazyPort<InvoiceLedgerWebhookPort>(
        ctx,
        'invoiceLedgerWebhookPort',
      ).handleAuthenticatedEvent({
        adapterId: LEDGER_VENDOR_FIXTURE_MODULE_ID,
        eventId,
        eventType: asString('eventType') ?? 'document_updated',
        remoteDocumentId: asString('remoteDocumentId'),
        vendorNumber: asString('vendorNumber'),
        asyncTaskId: asString('asyncTaskId'),
        ksefReferenceNumber: asString('ksefReferenceNumber'),
        errorMessage: asString('errorMessage'),
      });
      const status = result.outcome === 'applied' ? 201 : 200;
      return reply.status(status).send({ data: { status: result.outcome } });
    });
  });
}
