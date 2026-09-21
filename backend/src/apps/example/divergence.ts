import type { DeploymentDivergenceDeclaration } from '@endora-commerce/contracts';

/**
 * How `example` means to differ from core — and it means to differ in nothing.
 *
 * The file exists anyway, empty, because the mechanism is easier to find than to
 * remember: a deployment that genuinely drops a module has to say so here, with
 * a reason, or the platform refuses to boot (`assertLockedModulesPresent`). An
 * absent file means the same thing and teaches nobody. Every field is written
 * out for that same reason — a field an author never sees is a field they never
 * learn they have.
 *
 * Three things are declared here and only three, because they are the three no
 * walk can produce:
 *
 *  - `omittedModules` — a module this deployment does not ship, with a reason
 *    in prose. D-101, and the boot refuses an omission that is not here. The
 *    declaration is **two-way**: an entry for a module this deployment does ship
 *    fails the boot exactly as loudly as an undeclared omission, because a stale
 *    entry is how a deployment silently reacquires the hazard it once declared.
 *  - `decorationOrder` — the wrapping order for a registration more than one of
 *    this deployment's overlay modules decorates. Checked, never applied.
 *  - `reasons` — one sentence per divergence the platform derives, keyed by the
 *    derived entry's own key. It answers; it cannot enumerate.
 *
 * Anything the platform can derive is derived and does not belong here: the
 * module list, the routes, the locales, and whether a module is switched on —
 * that last one is the operator's axis, on `/platform/modules`.
 */
export const divergence: DeploymentDivergenceDeclaration = {
  omittedModules: [],
  decorationOrder: {},
  reasons: {
    // `ledger_vendor_fixture` — D-256's wave-4 prologue. Twelve entries, and the
    // count is the point rather than an accident: a ledger vendor is the widest
    // consumer surface `invoice_ledger` and `invoices` publish, and after wave 4
    // this deployment is the only place in the repository where any of it is
    // resolved at all. Each reason below says what the fixture takes from the
    // owner and what it gives back, and none of them is a behaviour a shop would
    // notice — the module ships off, owns no table and serves one route nobody
    // navigates to.
    'port-consumed:ledger_vendor_fixture:invoiceLedgerDeliveryPort':
      'The ledger’s own delivery row, read and advanced by the vendor that is delivering it. ' +
      'This is the port with the widest consumer surface of the four — `markAwaitingRemote`, ' +
      '`markSucceeded`, `markFailed`, `recordQueuedWait`, `rememberClient`, `findClientRemoteId` ' +
      'and `findDocumentRemoteId` — and after feature 134’s wave 4 removes `wfirma` and ' +
      '`infakt` it has no other caller in this repository, so a breaking change to it would ' +
      'type-check green here and red in another repository days later (FR-063). Rung 3 exactly ' +
      'as the ladder intends: the owner published the port, the consumer declares the ' +
      'dependency, and nothing of `invoice_ledger` is wrapped or replaced.',
    'port-consumed:ledger_vendor_fixture:invoiceLedgerVendorFreezeRegistry':
      'The contribution seam `invoice_ledger` publishes so that a vendor can say, at enqueue ' +
      'time, which credential and which environment a delivery will be frozen against. The push ' +
      'is keyed by this module’s own id and happens in a boot hook that does not probe its own ' +
      'presence (D-67/D-68), because the owner filters by contributor at the read.',
    'port-consumed:ledger_vendor_fixture:invoiceLedgerRegistryPort':
      'The vendor mutex. `invoice-ledger-vendor` is an exclusive capability, and the refusal is ' +
      'minted by `invoice_ledger` while the question is asked by each member’s own activation ' +
      'interceptor — only the vendor knows which activation request is about it. Consuming it ' +
      'here is what keeps that shape exercised after the two real members leave.',
    'port-consumed:ledger_vendor_fixture:invoiceLedgerWebhookPort':
      'What the ledger does with an authenticated vendor event, reached from this module’s one ' +
      'route. The signature scheme is the vendor’s own and is deliberately not reproduced: the ' +
      'fixture authenticates with a shared secret, because what the free ledger owns is ' +
      'everything after authentication and that is the only part this call exercises.',
    'port-consumed:ledger_vendor_fixture:invoiceCopyHostPort':
      'The buyer snapshot and lines a VAT copy is built from — the only way any ledger vendor ' +
      'learns anything about an invoice, and read-only by construction. The fixture builds no ' +
      'document from it; it reads the same fields a real vendor reads so that the record shape ' +
      'stays compiled against from the consumer side.',
    'port-consumed:ledger_vendor_fixture:invoiceNumberingHostPort':
      'The write a vendor makes back onto an invoice when the ledger’s numbering mode hands ' +
      'numbering to the vendor. Consumed rather than simulated, because `applyVendorAssignedNumber` ' +
      'would otherwise have no caller in this repository after wave 4.',
    'port-consumed:ledger_vendor_fixture:invoiceKsefAssignmentPort':
      'The same argument one field over: when the ledger delegates KSeF to the vendor, the ' +
      'vendor records the reference it got back. KSeF is a legal clearing system rather than a ' +
      'vendor (FR-024), so this port stays in the free tier and keeps a caller here.',
    'port-consumed:ledger_vendor_fixture:credentialsService':
      'The fixture’s API key and webhook secret, resolved by the frozen credential code the ' +
      'delivery row carries rather than by a live settings read — freezing is the property the ' +
      'free ledger’s retry assertions are about, and a fixture that read live values would ' +
      'exercise the opposite of it.',
    'port-consumed:ledger_vendor_fixture:configurationTypeRegistry':
      'The credential shape this vendor’s connection takes, described to `credentials` from a ' +
      'boot hook so that its admin screen can render a form for it. A contribution, not a ' +
      'gate: the owner filters by contributor when it enumerates, so switching this module off ' +
      'withdraws the type while leaving any stored row visible.',
    'registration:ledger_vendor_fixture:ledgerFixtureHttp':
      'This vendor’s one outward port, declared in the module’s own directory rather than in ' +
      '`@endora-commerce/contracts` because nobody outside the module speaks it. It composes to ' +
      'a client that **refuses** every call, for the same reason `product_feeds`’ delivery ' +
      'adapters do: there is no remote here, so a code path that starts reaching for one has to ' +
      'fail loudly rather than quietly succeed.',
    'registration:ledger_vendor_fixture:ledgerFixtureConnection':
      'Where this vendor resolves `credentials` from, and it is a registration rather than a ' +
      'closure inside the boot hook for a reason `check:port-dependencies` states better than ' +
      'prose would: `credentialsService` is a gated port, a boot hook runs whatever the owning ' +
      'module\u2019s effective state is, and a resolution written there would let an operator ' +
      'switching `credentials` off stop the next start with the screen they would undo it from ' +
      'unreachable. Registered, the resolution happens in a factory the container calls at use, ' +
      'so the same \u201cno\u201d stops one enqueue. It is the shape both real vendors already ' +
      'have.',
    'registration:ledger_vendor_fixture:ledgerFixtureDeliveryProcessor':
      'The vendor half of a delivery: the sequence of calls a ledger vendor makes between ' +
      'picking a queued row up and marking it delivered. It owns no queue and no worker, ' +
      'deliberately — a queue is a vendor’s own scaling decision and nothing in the ledger’s ' +
      'contract is expressed through one, so a fixture with a queue would add Redis to this ' +
      'deployment’s boot and prove nothing the free module owns.',
    'interceptor:ledger_vendor_fixture:POST /api/v1/admin/modules/:id/activation#pre':
      'The exclusive capability’s enforcement, which is each member’s own. It runs before the ' +
      'kernel’s activation handler, asks `invoice_ledger` whether a sibling vendor is already ' +
      'active, and refuses with the owner’s code when one is. It vetoes only a request naming ' +
      'this module and only when that request switches it on; every other activation, and every ' +
      'deactivation, passes through untouched.',
    'port-consumed:carrier_fixture:shippingAdapterRegistry':
      'The contribution seam `delivery_methods` publishes for a module that ships parcels, ' +
      'reached from this fixture’s boot hook so that the carrier port keeps an implementor in ' +
      'this repository after feature 134’s wave 1 removes `inpost` and `dhl_parcel` (FR-021, ' +
      'FR-063). It is rung 3 read exactly as the ladder intends: the owner published the seam, ' +
      'the consumer declares the dependency, and nothing of `delivery_methods` is wrapped or ' +
      'replaced. The fixture is a reference implementor rather than a delivery capability — it ' +
      'seeds no method, owns no table and serves no route — so what this deployment gains is a ' +
      'contributor to an existing registry and no behaviour a shop would notice.',
    'decoration:example_overlay:pricingService':
      'Core resolves a line price from the price lists a customer is entitled to. This ' +
      'deployment prefixes the resolved list id so that a reference reader can see, on a live ' +
      'response, which layer produced the price. The wrap delegates to `price_lists` and ' +
      'adjusts what core returned, so a core fix to `resolveLinePrice` still reaches this ' +
      'deployment — which is the whole difference between decorating and replacing (D-28).',
    'interceptor:example_overlay:GET /api/v1/admin/example-overlay/ping#post':
      'Core serves nothing on this endpoint: the route is this deployment’s own, and the ' +
      'interceptor stamps its response so that the reference deployment demonstrates the ' +
      'rung-2 seam end to end. It runs after the handler and adds a field; it vetoes nothing ' +
      'and writes nothing, which is what a `post` interceptor may do.',
    'registration:example_overlay:exampleOverlayService':
      'Core registers no service of this name — it is this deployment’s own, and it exists so ' +
      'that the container’s ownership ledger has an overlay claimant to answer for. A core ' +
      'module registering `exampleOverlayService` would collide loudly, which is the property ' +
      'being demonstrated.',
    'decoration:comarch_xl_example_overlay:comarchXlSellabilityPort':
      'Core leaves new XL catalogue products not sellable until an overlay policy allows it ' +
      '(004 FR-012). This reference overlay marks SKUs matching ^DEMO- as sellable and listed, ' +
      'delegating every other SKU to the core default so a fix to `DefaultComarchXlSellabilityPort` ' +
      'still reaches this deployment — which is the whole difference between decorating and ' +
      'replacing (D-28).',
  },
};
