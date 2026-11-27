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
 * These are declared here and nothing else, because they are what no walk can
 * produce:
 *
 *  - `omittedModules` — a module this deployment does not ship, with a reason
 *    in prose. D-101, and the boot refuses an omission that is not here. The
 *    declaration is **two-way**: an entry for a module this deployment does ship
 *    fails the boot exactly as loudly as an undeclared omission, because a stale
 *    entry is how a deployment silently reacquires the hazard it once declared.
 *  - `decorationOrder` — the wrapping order for a registration more than one of
 *    this deployment's overlay modules decorates. Checked, never applied.
 *  - `commandHookOrder` — the order of two command-hook modules on one action
 *    that no manifest dependency ranks (spec 176). Optional; written out here
 *    for the same reason the others are.
 *  - `commandMiddlewareOrder` — the order of two `admit` command-middleware
 *    modules whose filters can meet and that no manifest dependency ranks
 *    (spec 189). Optional, and it lists at least two modules, so it is absent
 *    here: this deployment's one middleware is an `observe`, which is never
 *    ordered.
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
  // `specs/176-command-hooks-outbox/` FR-014 — the order of two hook modules on
  // one action that no manifest dependency ranks. `command_hook_fixture` and
  // `example_erp_keys` both hook `organization.create` and neither depends on
  // the other. The fixture runs first: it may veto, and a refusal before the ERP
  // key is written is one statement fewer to roll back. The two never act on the
  // same create in practice — the fixture only on a marked name, the ERP keys
  // module only when the caller hands it a key.
  commandHookOrder: { 'organization.create': ['command_hook_fixture', 'example_erp_keys'] },
  reasons: {
    // `command_hook_fixture` — 176 P2. Two entries, one per hook, because a
    // command hook is keyed by its id: one module may register several on one
    // action and each is its own divergence.
    'command-hook:command_hook_fixture:organization.create#observe-create':
      'Core creates an Organization in one audited Command. This fixture takes part in that write ' +
      'only for an Organization whose name carries its marker: inside the same transaction it ' +
      'records an audit entry of its own, names what it wrote in the core entry, and refuses with ' +
      'its own translated code when the name also carries its veto word. It is the reference hook ' +
      'module the command-hook contract tests compose, and it changes nothing for any other name.',
    'command-hook:command_hook_fixture:organization.register#observe-register':
      'The same hook on storefront self-registration, which is one Command since spec 176 P1. On ' +
      'a marked name it writes its own audit entry inside the registration transaction and may ' +
      'refuse the registration with its own code, so the whole registration — Organization, ' +
      'first account, token — rolls back; any other name passes through untouched.',
    // 176 P3 — the fixture's two `afterCommit` handlers, delivered through the
    // transactional outbox.
    'command-hook:command_hook_fixture:organization.create#deliver-create':
      'After an Organization is created, the outbox delivers this handler one row of ids and codes, ' +
      'at least once and in a context pinned to that Organization. For an Organization its ' +
      'beforeCommit hook saw marked, in the same process, it records what it was handed in an ' +
      'audit entry of its own, which the outbox integration tests read; for any other it does nothing.',
    'command-hook:command_hook_fixture:organization.register#deliver-register':
      'The same handler on storefront self-registration: its row is written in the registration ' +
      'transaction, so a registration that rolls back leaves none, and delivery restores the new ' +
      "Organization's context and the registration's request id. It acts only on a marked name.",
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
    // `ledger_challenger_fixture` — feature 134, `research.md` D23 §2. Two entries,
    // because it carries one seam of `ledger_vendor_fixture`'s four: the family's
    // second declared member exists so the mutex stays a property of a pair after
    // the paid vendors leave, and that needs the interceptor and nothing else.
    'port-consumed:ledger_challenger_fixture:invoiceLedgerRegistryPort':
      'The vendor mutex, asked from this module’s own activation interceptor. A second ' +
      'declared member is what keeps the refusal a property of a pair once the paid vendors ' +
      'leave: with `ledger_vendor_fixture` alone the family would have no sibling the ' +
      'registry knows from a declaration and no second interceptor on the shared route.',
    'interceptor:ledger_challenger_fixture:POST /api/v1/admin/modules/:id/activation#pre':
      'The same enforcement `ledger_vendor_fixture` carries, for this member: it runs before ' +
      'the kernel’s activation handler and vetoes only a request switching this module on ' +
      'while a sibling vendor is active. Every other activation, and every deactivation, ' +
      'passes through untouched.',
    'port-consumed:carrier_fixture:shippingAdapterRegistry':
      'The contribution seam `delivery_methods` publishes for a module that ships parcels, ' +
      'reached from this fixture’s boot hook so that the carrier port keeps an implementor in ' +
      'this repository after feature 134’s wave 1 removes `inpost` and `dhl_parcel` (FR-021, ' +
      'FR-063). It is rung 3 read exactly as the ladder intends: the owner published the seam, ' +
      'the consumer declares the dependency, and nothing of `delivery_methods` is wrapped or ' +
      'replaced. The fixture is a reference implementor rather than a delivery capability — it ' +
      'seeds no method, owns no table and serves no route — so what this deployment gains is a ' +
      'contributor to an existing registry and no behaviour a shop would notice.',
    'port-consumed:payment_gateway_fixture:paymentAdapterRegistry':
      'The contribution seam `payment_methods` publishes for a module that settles a payment, ' +
      'reached from this fixture’s boot hook so that the gateway port keeps an implementor in ' +
      'this repository after feature 134’s wave 2 removes `autopay`, `paypal`, `payu`, `stripe` ' +
      'and `tpay` (FR-021, FR-063). It is the carrier fixture’s entry above one family over, and ' +
      'rung 3 read exactly as the ladder intends: the owner published the seam, the consumer ' +
      'declares the dependency, and nothing of `payment_methods` is wrapped or replaced. The ' +
      'fixture is a reference implementor rather than a payment capability — it seeds no method, ' +
      'owns no table and serves no route — so what this deployment gains is a contributor to an ' +
      'existing registry and no behaviour a shop would notice.',
    'port-consumed:payment_gateway_fixture:gatewayRefundRegistry':
      'The refund seam `payments` publishes for a module that settles a payment, reached from ' +
      'this fixture’s boot hook for the reason the adapter registry above is: once feature 134’s ' +
      'wave 2 removes `autopay`, `paypal`, `payu`, `stripe` and `tpay`, nothing else in this ' +
      'repository registers a refund handler, and `GatewayRefundRegistryPort` would be compiled ' +
      'against by no consumer at all (FR-021, FR-063). Same rung, same shape: the owner published ' +
      'the seam, the consumer declares it, and nothing of `payments` is wrapped or replaced.',
    // `overlay_notes_fixture` — 190 #1853 (FR-065, FR-066): the one overlay
    // declarer of an `x_*` column in this repository.
    'column-extension:overlay_notes_fixture:organizations':
      'Core keeps an Organization’s columns its own. This fixture adds one nullable column to ' +
      '`organizations`, for when the organization’s last note was written, through the generated ' +
      'schema-extension step an installed package would use: ledgered under the fixture’s id, ' +
      'never exposed on an admin read, and kept as orphaned with its values when the fixture is ' +
      'hard-uninstalled. No core column is changed, and nothing core runs reads it.',
    // `example_erp_keys` — 190 US8 (#1856), the reference overlay module. Its
    // side table on `organizations` is its own surface (`notRecorded`, with its
    // extension-attribute loader); what reaches into core is the three below.
    'command-hook:example_erp_keys:organization.create#fill-erp-key':
      'Core creates an Organization in one audited Command. When a server-side caller such as an ERP ' +
      'import hands the create an ERP key under `extensions.example_erp_keys`, this module writes the ' +
      'key into its own side table inside that transaction and names the field, never the value, in ' +
      'the core entry; a malformed key or one another Organization holds is refused with its own ' +
      'translated code and the whole create rolls back. A create without the extension, every ' +
      'administrator create included, is untouched.',
    'port-consumed:example_erp_keys:organizationDetailsPort':
      'The names its ERP-key list shows, read through the port `organizations` publishes for ' +
      'Organization records rather than by a join on a table this module does not own. Read-only, ' +
      'in the caller’s tenant context, and resolved per call, so `organizations` stays the one ' +
      'owner of what an Organization record is.',
    'port-provided:example_erp_keys:exampleErpKeysPort':
      'Core has no notion of an external ERP key. This port answers an Organization’s key, and the ' +
      'Organization holding a key, from this module’s own side table and in the caller’s scope; ' +
      'its types are in the module’s `ports.ts`. It fails closed while the module is off, and nothing ' +
      'in core resolves it.',
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
    // `command_middleware_fixture` — 189 P1. Two entries, one per declared
    // middleware, because a middleware is keyed by its id.
    'command-middleware:command_middleware_fixture:hold-marked':
      'Core admits every Command. This fixture refuses an Organization write — a child write ' +
      'inside a bigger one included — only for a request whose id carries its hold marker, with ' +
      'its own translated code and before anything is written. It is the reference admission ' +
      'rule the command-middleware contract tests compose, and it changes nothing for any other request.',
    'command-middleware:command_middleware_fixture:record-marked':
      'After a marked request’s Organization write has committed or rolled back, this fixture keeps ' +
      'the run’s names-only summary and the tenant context it was observed in, which the ' +
      'command-middleware tests read. It cannot slow, fail or change the write, and it ignores every ' +
      'request that does not carry its marker.',
    'command-middleware:example_overlay:organization-timing':
      'Core runs no middleware on the Command Bus. After any write that touched an Organization ' +
      'has committed or rolled back, this deployment logs how long it took and how it ended — ' +
      'the action, the outcome, the error code and a count, never a value. It is the reference ' +
      '`observe` middleware: it cannot slow, fail or change the write, and it replaces what a ' +
      'deployment used to do by wrapping `commandBus`.',
    'registration:example_overlay:exampleOverlayService':
      'Core registers no service of this name — it is this deployment’s own, and it exists so ' +
      'that the container’s ownership ledger has an overlay claimant to answer for. A core ' +
      'module registering `exampleOverlayService` would collide loudly, which is the property ' +
      'being demonstrated.',
  },
};
