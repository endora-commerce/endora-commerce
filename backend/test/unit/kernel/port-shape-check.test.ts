import { describe, expect, it } from 'vitest';
import {
  PORTS_WITHOUT_A_REGISTRATION,
  RESOLUTIONS_OF_UNPUBLISHED_NAMES,
  checkPortShape,
  type PortShapeInput,
} from '../../../scripts/check-port-shape.js';

/**
 * `check:port-shape` — the shapes it refuses, and the ones it must not.
 *
 * **Signal 1 (D-97.3)** is narrow on purpose: an optional **method** on a
 * published port, or on an interface widening one. Everything else optional in a
 * contract is ordinary — 34 optional members across the tree's ports are
 * parameters and data properties — so the discriminations below are as
 * load-bearing as the findings.
 *
 * **Signal 2 (issue #192)** compares the container name a port's doc block gives
 * to the name it is registered under. Its discriminations matter more than its
 * findings do: eleven published ports are deliberately plain `di.register`
 * contribution seams, and a signal that reported those would be turned off
 * within a week.
 *
 * Each case enters as source text, where a real run enters.
 */

const PORT_FILE = 'contracts/custom-fields.ts';

/** A published port, introduced the way every port in the tree is. */
const PUBLISHED_PORT = `
/**
 * Container name: \`customFieldDefinitionReadPort\`. Owner: \`custom_fields\`.
 */
export interface CustomFieldDefinitionReadPort {
  listForEntity(entityType: string): Promise<Definition[]>;
}
`;

/** The registration that name really has, so signal 2 is silent by default. */
const REGISTRATION_FILE = 'modules/custom_fields/backend.ts';
const GATED_REGISTRATION = `
export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort<CustomFieldDefinitionReadPort>(
    'customFieldDefinitionReadPort',
    ctx.asFunction(() => new CustomFieldDefinitionReadService()).singleton(),
  );
}
`;

function input(over: Partial<PortShapeInput> = {}): PortShapeInput {
  return {
    contracts: new Map([[PORT_FILE, PUBLISHED_PORT]]),
    modules: new Map([[REGISTRATION_FILE, GATED_REGISTRATION]]),
    // The tree's ledger describes the tree; a fixture that inherited it would
    // report its one entry stale on every case below.
    unregisteredLedger: {},
    ...over,
  };
}

describe('check:port-shape — what it refuses', () => {
  it('finds the doc-marked ports at all', () => {
    expect(checkPortShape(input()).portTypes).toEqual(['CustomFieldDefinitionReadPort']);
  });

  it('refuses an optional method on the published port itself', () => {
    const result = checkPortShape(
      input({
        contracts: new Map([
          [
            PORT_FILE,
            `
/**
 * Container name: \`customFieldDefinitionReadPort\`. Owner: \`custom_fields\`.
 */
export interface CustomFieldDefinitionReadPort {
  listForEntity(entityType: string): Promise<Definition[]>;
  publishInvalidate?(entityType: string): Promise<void>;
}
`,
          ],
        ]),
      }),
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: 'optional-method-on-port',
      typeName: 'CustomFieldDefinitionReadPort',
      member: 'publishInvalidate',
    });
  });

  it('refuses an optional method on a module interface extending a port', () => {
    // Verbatim the shape `catalog` carried until D-97.1 deleted it.
    const result = checkPortShape(
      input({
        modules: new Map([
          [
            'modules/catalog/services/catalog-attribute-read.service.ts',
            `
export interface AttributeDefinitionSource extends CustomFieldDefinitionReadPort {
  publishInvalidate?(entityType: 'product'): Promise<void>;
}
`,
          ],
        ]),
      }),
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: 'optional-method-on-port-extension',
      typeName: 'AttributeDefinitionSource',
      portName: 'CustomFieldDefinitionReadPort',
      member: 'publishInvalidate',
    });
  });

  it('reads the function-property spelling as the same promise', () => {
    const result = checkPortShape(
      input({
        modules: new Map([
          [
            'modules/catalog/services/widened.ts',
            `
export interface Widened extends CustomFieldDefinitionReadPort {
  publishInvalidate?: (entityType: string) => Promise<void>;
}
`,
          ],
        ]),
      }),
    );
    expect(result.findings.map((f) => f.member)).toEqual(['publishInvalidate']);
  });
});

describe('check:port-shape — what it leaves alone', () => {
  it('an optional parameter and an optional data property', () => {
    const result = checkPortShape(
      input({
        contracts: new Map([
          [
            PORT_FILE,
            `
/**
 * Container name: \`customFieldDefinitionReadPort\`. Owner: \`custom_fields\`.
 */
export interface CustomFieldDefinitionReadPort {
  listForEntity(entityType: string, locale?: string): Promise<Definition[]>;
  readonly label?: string;
}
`,
          ],
        ]),
      }),
    );
    expect(result.findings).toEqual([]);
  });

  it('an ordinary interface that is not a port and extends none', () => {
    const result = checkPortShape(
      input({
        modules: new Map([
          [
            'modules/catalog/services/local.ts',
            `
export interface LocalHelper {
  maybe?(): Promise<void>;
}
`,
          ],
        ]),
      }),
    );
    expect(result.findings).toEqual([]);
  });

  it('an interface whose doc block does not introduce a container name', () => {
    // The marker is the whole definition of "published". A type nobody
    // registers may be as optional as it likes.
    const result = checkPortShape({
      contracts: new Map([
        [
          PORT_FILE,
          `
/** A plain shape. */
export interface NotAPort {
  maybe?(): Promise<void>;
}
`,
        ],
      ]),
      modules: new Map(),
    });
    expect(result.portTypes).toEqual([]);
    expect(result.findings).toEqual([]);
  });
});

describe('check:port-shape — the documented container name (issue #192)', () => {
  /** A port doc naming `container`, plus whatever `modules` the case needs. */
  function named(container: string, modules: ReadonlyMap<string, string>): PortShapeInput {
    return input({
      contracts: new Map([
        [
          'contracts/admin-roles.ts',
          `
/**
 * Container name: \`${container}\`. Owner: \`admin_roles\`.
 */
export interface AdminRolePort {
  list(): Promise<AdminRoleRecord[]>;
}
`,
        ],
      ]),
      modules,
    });
  }

  it('is silent when the doc names the registration', () => {
    const result = checkPortShape(
      named(
        'adminRolePort',
        new Map([
          [
            'modules/admin_roles/backend.ts',
            "ctx.di.providePort<AdminRolePort>('adminRolePort', ctx.asFunction(f).singleton());",
          ],
        ]),
      ),
    );
    expect(result.nameFindings).toEqual([]);
  });

  it('refuses a container name nothing registers', () => {
    const result = checkPortShape(
      named(
        'impersonationService',
        new Map([
          [
            'modules/admin_users/backend.ts',
            "ctx.di.providePort('somethingElse', ctx.asFunction(f).singleton());",
          ],
        ]),
      ),
    );
    expect(result.nameFindings).toHaveLength(1);
    expect(result.nameFindings[0]).toMatchObject({
      kind: 'container-name-unregistered',
      portName: 'AdminRolePort',
      documented: 'impersonationService',
      documentedRegistrationKind: null,
    });
  });

  it('refuses a container name that is the ungated twin of the gated port', () => {
    // The `AdminRolePort` shape verbatim: a plain `di.register` of the class
    // under the documented name, and the gate under another one.
    const result = checkPortShape(
      named(
        'adminRoleService',
        new Map([
          [
            'modules/admin_roles/backend.ts',
            [
              'ctx.di.register({ adminRoleService: ctx.asFunction(f).singleton() });',
              "ctx.di.providePort<AdminRolePort>('adminRolePort', ctx.asFunction(g).singleton());",
            ].join('\n'),
          ],
        ]),
      ),
    );
    expect(result.nameFindings).toHaveLength(1);
    expect(result.nameFindings[0]).toMatchObject({
      kind: 'container-name-not-the-gated-registration',
      documented: 'adminRoleService',
      registered: 'adminRolePort',
      // The whole reason this shape is a build failure rather than a typo: the
      // name the contract advertises has no presence gate on it.
      documentedRegistrationKind: 'plain',
    });
  });

  it('refuses a stale ledger entry', () => {
    const result = checkPortShape(
      input({
        unregisteredLedger: { AdminRolePort: 'no provider, pending a ruling' },
      }),
    );
    expect(result.staleLedgerEntries).toEqual(['AdminRolePort']);
  });

  it('a ledger entry suppresses the unregistered finding, and only that one', () => {
    const suppressed = checkPortShape(
      named('moduleManifestReadPort', new Map([['modules/blog/backend.ts', 'const x = 1;']])),
    );
    expect(suppressed.nameFindings.map((f) => f.kind)).toEqual(['container-name-unregistered']);

    const ledgered = checkPortShape({
      ...named('moduleManifestReadPort', new Map([['modules/blog/backend.ts', 'const x = 1;']])),
      unregisteredLedger: { AdminRolePort: 'A4 — Q2 unresolved.' },
    });
    expect(ledgered.nameFindings).toEqual([]);
    expect(ledgered.staleLedgerEntries).toEqual([]);
  });
});

describe('check:port-shape — what the name signal leaves alone', () => {
  it('a contribution seam: a plain `di.register` under the documented name', () => {
    // Eleven published ports are registered this way on purpose — the four this
    // check was written beside among them. Reporting one would be a signal that
    // fires on the design working.
    const result = checkPortShape(
      input({
        contracts: new Map([
          [
            'contracts/assets-library.ts',
            `
/**
 * Container name: \`assetReferenceRegistry\`. Owner: \`assets_library\`.
 */
export interface AssetReferenceRegistryPort {
  register(scanner: Scanner): void;
}
`,
          ],
        ]),
        modules: new Map([
          [
            'modules/assets_library/backend.ts',
            'ctx.di.register({ assetReferenceRegistry: ctx.asFunction(f).singleton() });',
          ],
        ]),
      }),
    );
    expect(result.nameFindings).toEqual([]);
  });

  it('an untyped `providePort` under another name', () => {
    // 53 of 134 registrations carry no type argument, so nothing ties them to a
    // contract. Guessing an owner from the spelling is how a name check acquires
    // false positives; this one declines to guess.
    const result = checkPortShape(
      input({
        contracts: new Map([
          [
            'contracts/addresses.ts',
            `
/**
 * Container name: \`addressService\`. Owner: \`addresses\`.
 */
export interface AddressServicePort {
  list(): Promise<AddressRecord[]>;
}
`,
          ],
        ]),
        modules: new Map([
          [
            'modules/addresses/backend.ts',
            [
              "ctx.di.providePort('addressService', ctx.asFunction(f).singleton());",
              "ctx.di.providePort('addressServicePort', ctx.asFunction(g).singleton());",
            ].join('\n'),
          ],
        ]),
      }),
    );
    expect(result.nameFindings).toEqual([]);
  });

  it('an interface whose doc block gives no parseable container name', () => {
    const result = checkPortShape(
      input({
        contracts: new Map([
          [
            PORT_FILE,
            `
/** Container name: see the module. Owner: \`custom_fields\`. */
export interface CustomFieldDefinitionReadPort {
  listForEntity(entityType: string): Promise<Definition[]>;
}
`,
          ],
        ]),
      }),
    );
    expect(result.portTypes).toEqual(['CustomFieldDefinitionReadPort']);
    expect(result.nameFindings).toEqual([]);
  });
});

describe('check:port-shape — it cannot report a vacuous pass', () => {
  it('counts the registrations it read, so an empty scan is distinguishable', () => {
    // The CLI turns this zero into exit 2. Without it, a module scan that read
    // nothing would report all 98 ports as unregistered and a reader would
    // "fix" the flood by widening the ledger — which is the check turned off.
    expect(checkPortShape(input({ modules: new Map() })).registeredNameCount).toBe(0);
    expect(checkPortShape(input()).registeredNameCount).toBeGreaterThan(0);
  });
});

describe('the ledger the tree ships', () => {
  it('is empty: its one entry was answered by D-98.5, not carried forward', () => {
    // `ModuleManifestReadPort` stood unprovided while the audit's Q2 was open.
    // Q2 answered platform-owned, the interface is deleted, and the entry
    // retired by the condition it named. Nothing has taken its place, which is
    // the state a ledger of this kind should be in.
    expect(Object.entries(PORTS_WITHOUT_A_REGISTRATION)).toHaveLength(0);
  });

  it('still requires a reason and a retirement condition of any entry added', () => {
    for (const [portName, reason] of Object.entries(PORTS_WITHOUT_A_REGISTRATION)) {
      expect(reason.length, `${portName} has no reason`).toBeGreaterThan(60);
      expect(reason, `${portName} does not say what retires it`).toMatch(/Retired by/i);
    }
  });
});

/**
 * **Signal 3 (issue #196, D-98.2)** — the other direction of the same edge.
 *
 * Signal 2 above reads *contract doc → registration*. This reads *consumer
 * resolution → publication*, and the reason both exist is measured rather than
 * theoretical: !698 corrected eight doc blocks and the three consumers that
 * were resolving the wrong name stayed wrong, invisible to every check running.
 *
 * The discriminations carry as much of the rule as the finding does. Four of
 * the five names the two population methods disagree on are reached by a
 * **cradle** read rather than a `lazyPort` literal, and those are contribution
 * seams where a cradle read is correct — so the case below proves the signal
 * declines them while reporting a `lazyPort` over the very same name in the
 * very same fixture. A path excluded silently is a path nobody can check.
 */
describe('check:port-shape — signal 3, resolving a name nothing publishes', () => {
  /** A published port and its gated registration, so signals 1 and 2 stay quiet. */
  const PUBLISHED = new Map([
    [
      'contracts/admin-notifications.ts',
      `
/**
 * Container name: \`adminNotificationRecordPort\`. Owner: \`admin_notifications\`.
 */
export interface AdminNotificationRecordPort {
  record(input: RecordAdminNotificationInput): Promise<AdminNotificationRecord>;
}
`,
    ],
  ]);

  /**
   * The owner registers both: the published port, and the class the port was
   * published to replace. That second registration is what a consumer copies.
   */
  const OWNER = [
    'modules/admin_notifications/backend.ts',
    [
      "ctx.di.providePort<AdminNotificationRecordPort>('adminNotificationRecordPort', ctx.asFunction(f).singleton());",
      "ctx.di.providePort('adminNotificationService', ctx.asFunction(g).singleton());",
    ].join('\n'),
  ] as const;

  function scenario(
    consumers: ReadonlyArray<readonly [string, string]>,
    ledger: Readonly<Record<string, string>> = {},
  ): PortShapeInput {
    return {
      contracts: PUBLISHED,
      modules: new Map([OWNER, ...consumers]),
      unregisteredLedger: {},
      unpublishedResolutionLedger: ledger,
    };
  }

  it('refuses a cross-module resolution of a registered, unpublished name', () => {
    const result = checkPortShape(
      scenario([
        [
          'modules/product_feeds/backend.ts',
          "const bell = lazyPort<AdminNotificationPort>(ctx, 'adminNotificationService');",
        ],
      ]),
    );
    expect(result.unpublishedResolutions).toHaveLength(1);
    expect(result.unpublishedResolutions[0]).toMatchObject({
      kind: 'resolution-of-unpublished-name',
      moduleId: 'product_feeds',
      owner: 'admin_notifications',
      name: 'adminNotificationService',
      line: 1,
    });
  });

  it('is silent when the consumer resolves the published name', () => {
    const result = checkPortShape(
      scenario([
        [
          'modules/product_feeds/backend.ts',
          "const bell = lazyPort<AdminNotificationRecordPort>(ctx, 'adminNotificationRecordPort');",
        ],
      ]),
    );
    expect(result.unpublishedResolutions).toEqual([]);
  });

  it('is silent for a module resolving its own unpublished registration', () => {
    // `admin_notifications` resolves `adminNotificationService` from its own
    // route registrar, lazily and deliberately (D-40). A module naming its own
    // registration crosses no boundary, so there is nothing for a contract to
    // publish to it.
    const result = checkPortShape(
      scenario([
        [
          'modules/admin_notifications/routes.ts',
          "const own = lazyPort<AdminNotificationService>(ctx, 'adminNotificationService');",
        ],
      ]),
    );
    expect(result.unpublishedResolutions).toEqual([]);
  });

  it('discriminates a cradle read from a `lazyPort` literal over the same name', () => {
    // Both shapes, one fixture, one name. The cradle read is a contribution
    // seam — a name a composition root or the kernel supplies — and requiring a
    // published contract for it would be the wrong rule; the `lazyPort` literal
    // is a developer copying a name out of a doc block, which is exactly what
    // can be checked against one. The signal must tell them apart, and this is
    // the case that says it does rather than a path quietly excluded.
    const result = checkPortShape(
      scenario([
        [
          'modules/product_feeds/backend.ts',
          [
            'const { adminNotificationService } = ctx.cradle<ProductFeedsCradle>();',
            "const also = ctx.cradle<ProductFeedsCradle>().adminNotificationService;",
            "const copied = lazyPort<Port>(ctx, 'adminNotificationService');",
          ].join('\n'),
        ],
      ]),
    );
    expect(result.unpublishedResolutions).toHaveLength(1);
    expect(result.unpublishedResolutions[0]).toMatchObject({
      kind: 'resolution-of-unpublished-name',
      line: 3,
    });
  });

  it('refuses a stale ledger entry', () => {
    const result = checkPortShape(
      scenario(
        [
          [
            'modules/product_feeds/backend.ts',
            "const bell = lazyPort<AdminNotificationRecordPort>(ctx, 'adminNotificationRecordPort');",
          ],
        ],
        { 'product_feeds:adminNotificationService': 'deferred, pending the cut' },
      ),
    );
    expect(result.unpublishedResolutions).toEqual([]);
    expect(result.staleUnpublishedResolutions).toEqual([
      'product_feeds:adminNotificationService',
    ]);
  });

  it('a ledger entry suppresses exactly its own `<consumer>:<name>` pair', () => {
    const result = checkPortShape(
      scenario(
        [
          [
            'modules/product_feeds/backend.ts',
            "const bell = lazyPort<Port>(ctx, 'adminNotificationService');",
          ],
          [
            'modules/pim_ergonode/backend.ts',
            "const bell = lazyPort<Port>(ctx, 'adminNotificationService');",
          ],
        ],
        { 'product_feeds:adminNotificationService': 'deferred, pending the cut' },
      ),
    );
    expect(result.unpublishedResolutions.map((f) => f.moduleId)).toEqual(['pim_ergonode']);
    expect(result.staleUnpublishedResolutions).toEqual([]);
  });

  it('leaves a platform-owned name alone', () => {
    // `settingsReadPort` is composed by a root and has no owning module, so
    // there is no contracts file it could be published from.
    const result = checkPortShape(
      scenario([
        [
          'modules/product_feeds/backend.ts',
          "const settings = lazyPort<SettingsService>(ctx, 'settingsReadPort');",
        ],
      ]),
    );
    expect(result.unpublishedResolutions).toEqual([]);
  });

  it('leaves a name no module registers to `check:port-dependencies`', () => {
    // That check calls it `unowned-name` and names the file and line. Reporting
    // it here as well would give one defect two voices and two repairs.
    const result = checkPortShape(
      scenario([
        [
          'modules/product_feeds/backend.ts',
          "const nothing = lazyPort<Whatever>(ctx, 'nobodyRegistersThis');",
        ],
      ]),
    );
    expect(result.unpublishedResolutions).toEqual([]);
  });

  it('reads both container names when one shape has two providers', () => {
    // `OrderStatusRegistry` verbatim: one published interface, registered by
    // `payment_methods` and by `delivery_methods` under different names. A doc
    // block parsed for only the first name left the second unpublished and
    // reported `shipments` for resolving it.
    const result = checkPortShape({
      contracts: new Map([
        [
          'contracts/payment-methods.ts',
          `
/**
 * Container name: \`paymentOrderStatusRegistry\`. Owner: \`payment_methods\`.
 * Container name: \`shippingOrderStatusRegistry\`. Owner: \`delivery_methods\`.
 */
export interface OrderStatusRegistry {
  has(code: string): boolean;
}
`,
        ],
      ]),
      modules: new Map([
        [
          'modules/delivery_methods/backend.ts',
          'ctx.di.register({ shippingOrderStatusRegistry: ctx.asFunction(f).singleton() });',
        ],
        [
          'modules/shipments/backend.ts',
          "const registry = lazyPort<OrderStatusRegistry>(ctx, 'shippingOrderStatusRegistry');",
        ],
      ]),
      unregisteredLedger: {},
      unpublishedResolutionLedger: {},
    });
    expect(result.unpublishedResolutions).toEqual([]);
    // And the documented name nothing registers is still a signal-2 finding,
    // so the widening did not turn the first name off.
    expect(result.nameFindings).toMatchObject([
      { kind: 'container-name-unregistered', documented: 'paymentOrderStatusRegistry' },
    ]);
  });

  it('counts its two inputs, so neither can be empty behind a green', () => {
    // The CLI turns each zero into exit 2. An empty published set would report
    // every cross-module resolution in the tree; an empty resolution set would
    // report nothing at all, which reads as clean.
    const withBoth = checkPortShape(
      scenario([
        [
          'modules/product_feeds/backend.ts',
          "const bell = lazyPort<Port>(ctx, 'adminNotificationRecordPort');",
        ],
      ]),
    );
    expect(withBoth.publishedContainerCount).toBeGreaterThan(0);
    expect(withBoth.lazyPortResolutionCount).toBeGreaterThan(0);

    const noContracts = checkPortShape({ ...scenario([]), contracts: new Map() });
    expect(noContracts.publishedContainerCount).toBe(0);
    expect(checkPortShape(scenario([])).lazyPortResolutionCount).toBe(0);
  });
});

describe('the resolution ledger the tree ships', () => {
  it('requires a reason and a retirement condition of every entry', () => {
    for (const [key, reason] of Object.entries(RESOLUTIONS_OF_UNPUBLISHED_NAMES)) {
      expect(key, `${key} is not keyed <consumer>:<name>`).toMatch(/^[a-z_]+:[A-Za-z]+$/);
      expect(reason.length, `${key} has no reason`).toBeGreaterThan(80);
      expect(reason, `${key} does not say what retires it`).toMatch(/retire|Retired|F4|deferred/i);
    }
  });
});

/**
 * **Signal 4 (D-171.1)** — the condition consumer-side declaration is licensed
 * against, and the widening of the published population that gives it a
 * subject.
 *
 * D-171 §4 refused consumer-side declaration outright, on the ground that
 * `lazyPort<T>` is an unchecked cast. It is — and that is about the wrong seam:
 * conformance is checked on the **provider**, at its `implements` clause and at
 * its explicitly typed `providePort<T>`, both of which resolve the interface
 * wherever it was declared. So the amendment licenses the placement against the
 * provider naming the interface at both, and this signal is the half a check
 * can see.
 *
 * The discriminations carry more of the rule than the finding does. A signal
 * that reported every cross-module registration would be turned off within a
 * week, and one that had stopped reading module ports at all reports the same
 * clean zero — which is why the tree's own four module-declared ports are
 * asserted as a population rather than assumed.
 */
const ORDERS_PORTS = 'modules/orders/ports/index.ts';
const DECLARED_ELSEWHERE = [
  '/**',
  ' * Container name: `paymentPlacementApplyPort`. Owner: `payments`.',
  ' *',
  ' * Declared here and implemented by `payments`: the reaches are mutual, and',
  ' * `payments.dependencies` contains `orders` (D-171.1).',
  ' */',
  'export interface PaymentPlacementApplyPort {',
  '  openForOrder(em: EntityManager, orderId: string): Promise<void>;',
  '}',
].join('\n');
const PAYMENTS_REGISTRATION = [
  'export function registerModule(ctx: ModuleContext): void {',
  "  ctx.di.providePort<PaymentPlacementApplyPort>('paymentPlacementApplyPort',",
  '    ctx.asFunction(() => new PaymentPlacementApplyService()).singleton());',
  '}',
].join('\n');

function mutualPair(service: string): PortShapeInput {
  return {
    contracts: new Map([[PORT_FILE, PUBLISHED_PORT]]),
    modules: new Map([
      [REGISTRATION_FILE, GATED_REGISTRATION],
      ['modules/payments/backend.ts', PAYMENTS_REGISTRATION],
      ['modules/payments/services/payment-placement-apply-port.ts', service],
    ]),
    modulePorts: new Map([[ORDERS_PORTS, DECLARED_ELSEWHERE]]),
    unregisteredLedger: {},
    unpublishedResolutionLedger: {},
  };
}

const IMPLEMENTING = [
  'export class PaymentPlacementApplyService implements PaymentPlacementApplyPort {',
  '  async openForOrder(em: EntityManager, orderId: string): Promise<void> {}',
  '}',
].join('\n');
const NOT_IMPLEMENTING = [
  'export class PaymentPlacementApplyService {',
  '  async openForOrder(em: EntityManager, orderId: string): Promise<void> {}',
  '}',
].join('\n');

describe('check:port-shape — the D-171.1 condition', () => {
  it('refuses an interface declared by one module and implemented by no class in the provider', () => {
    const result = checkPortShape(mutualPair(NOT_IMPLEMENTING));
    expect(result.declaredElsewhere).toHaveLength(1);
    expect(result.declaredElsewhere[0]).toMatchObject({
      portName: 'PaymentPlacementApplyPort',
      declaringModule: 'orders',
      providingModule: 'payments',
      container: 'paymentPlacementApplyPort',
      kind: 'declared-elsewhere-without-implements',
    });
  });

  it('is silent when the provider names it at an `implements` clause', () => {
    // The whole of the amendment: the placement is legal, the condition is the
    // provider's. A signal that reported this would refuse D-171.1 itself.
    expect(checkPortShape(mutualPair(IMPLEMENTING)).declaredElsewhere).toHaveLength(0);
  });

  it('is silent when the declaring module is the provider — the ordinary case', () => {
    // D-171 §4's unamended half. Nothing about a single reach changes, so a
    // module declaring and registering its own port is outside the population
    // whether or not it writes an `implements` clause.
    const result = checkPortShape({
      contracts: new Map([[PORT_FILE, PUBLISHED_PORT]]),
      modules: new Map([['modules/orders/backend.ts', PAYMENTS_REGISTRATION]]),
      modulePorts: new Map([[ORDERS_PORTS, DECLARED_ELSEWHERE]]),
      unregisteredLedger: {},
      unpublishedResolutionLedger: {},
    });
    expect(result.declaredElsewhere).toHaveLength(0);
  });

  it('is silent for a port in the contracts package, which belongs to no module', () => {
    // "Declared elsewhere" has no meaning for a contract: it is nobody's
    // module, so there is no other side for the declaration to be on.
    const result = checkPortShape({
      contracts: new Map([
        [PORT_FILE, PUBLISHED_PORT],
        ['contracts/payments.ts', DECLARED_ELSEWHERE],
      ]),
      modules: new Map([
        [REGISTRATION_FILE, GATED_REGISTRATION],
        ['modules/payments/backend.ts', PAYMENTS_REGISTRATION],
        ['modules/payments/services/payment-placement-apply-port.ts', NOT_IMPLEMENTING],
      ]),
      unregisteredLedger: {},
      unpublishedResolutionLedger: {},
    });
    expect(result.declaredElsewhere).toHaveLength(0);
  });

  it('does not see an untyped registration, so its port lands in the unregistered ledger instead', () => {
    // The complementary direction, which needs no code of its own: dropping the
    // explicit type argument stops the call being a registration this check can
    // attribute, so the interface reads as provided by nothing. That is what
    // makes the explicit argument part of the condition rather than a style
    // note — an inferred `T` compares nothing, here or in `tsc`.
    const result = checkPortShape({
      contracts: new Map([[PORT_FILE, PUBLISHED_PORT]]),
      modules: new Map([
        [REGISTRATION_FILE, GATED_REGISTRATION],
        [
          'modules/payments/backend.ts',
          "ctx.di.providePort('somethingElse', ctx.asFunction(f).singleton());",
        ],
      ]),
      modulePorts: new Map([[ORDERS_PORTS, DECLARED_ELSEWHERE]]),
      unregisteredLedger: {},
      unpublishedResolutionLedger: {},
    });
    expect(result.declaredElsewhere).toHaveLength(0);
    expect(
      result.nameFindings.filter((f) => f.kind === 'container-name-unregistered'),
    ).toHaveLength(1);
  });
});

describe('check:port-shape — the widened published population (D-171.1)', () => {
  it('publishes a name declared on a module port, so a consumer resolving it is not a finding', () => {
    // The half of the widening that retires the resolution ledger: before it,
    // the container name below was published by nothing and the consumer's
    // `lazyPort` was `resolution-of-unpublished-name`.
    const consumer = new Map([
      [REGISTRATION_FILE, GATED_REGISTRATION],
      ['modules/payments/backend.ts', PAYMENTS_REGISTRATION],
      ['modules/payments/services/payment-placement-apply-port.ts', IMPLEMENTING],
      [
        'modules/orders/services/order-service.ts',
        "const pay = lazyPort<PaymentPlacementApplyPort>(ctx, 'paymentPlacementApplyPort');",
      ],
    ]);
    const base = {
      contracts: new Map([[PORT_FILE, PUBLISHED_PORT]]),
      modules: consumer,
      unregisteredLedger: {},
      unpublishedResolutionLedger: {},
    };
    expect(checkPortShape(base).unpublishedResolutions).toHaveLength(1);
    expect(
      checkPortShape({ ...base, modulePorts: new Map([[ORDERS_PORTS, DECLARED_ELSEWHERE]]) })
        .unpublishedResolutions,
    ).toHaveLength(0);
  });

  it('counts the module ports it read, so a walk that produced none is distinguishable', () => {
    // The CLI turns this zero into exit 2. Without it a walk that stopped
    // producing ports would report the resolution ledger's retired entries as
    // stale, and the obvious repair — deleting them — records a repair that
    // never happened (issue #113).
    expect(checkPortShape(mutualPair(IMPLEMENTING)).modulePortCount).toBe(1);
    expect(
      checkPortShape({ ...mutualPair(IMPLEMENTING), modulePorts: new Map() }).modulePortCount,
    ).toBe(0);
  });

  it('applies the optional-method rule to a module-declared port too', () => {
    // Signal 1 over the widened population: an optional method is the same
    // hazard whichever side of the boundary declared the interface, because
    // `lazyPort`'s proxy answers every property with a function either way.
    const result = checkPortShape({
      contracts: new Map([[PORT_FILE, PUBLISHED_PORT]]),
      modules: new Map([[REGISTRATION_FILE, GATED_REGISTRATION]]),
      modulePorts: new Map([
        [
          ORDERS_PORTS,
          [
            '/** Container name: `paymentPlacementApplyPort`. */',
            'export interface PaymentPlacementApplyPort {',
            '  openForOrder(em: EntityManager): Promise<void>;',
            '  markDeferred?(em: EntityManager): Promise<void>;',
            '}',
          ].join('\n'),
        ],
      ]),
      unregisteredLedger: {},
      unpublishedResolutionLedger: {},
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      member: 'markDeferred',
      kind: 'optional-method-on-port',
    });
  });

  it('reports a port once when the same file arrives in both halves of the walk', () => {
    // A real run walks a package's ports file twice — it is a module source and
    // it is a port declaration — so signal 1 scans the union keyed by file. The
    // concatenation would report one optional method as two.
    const withOptional = [
      '/** Container name: `paymentPlacementApplyPort`. */',
      'export interface PaymentPlacementApplyPort {',
      '  markDeferred?(em: EntityManager): Promise<void>;',
      '}',
    ].join('\n');
    const result = checkPortShape({
      contracts: new Map([[PORT_FILE, PUBLISHED_PORT]]),
      modules: new Map([
        [REGISTRATION_FILE, GATED_REGISTRATION],
        [ORDERS_PORTS, withOptional],
      ]),
      modulePorts: new Map([[ORDERS_PORTS, withOptional]]),
      unregisteredLedger: {},
      unpublishedResolutionLedger: {},
    });
    expect(result.findings).toHaveLength(1);
  });
});
