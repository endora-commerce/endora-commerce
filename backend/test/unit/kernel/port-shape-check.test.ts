import { describe, expect, it } from 'vitest';
import {
  PORTS_WITHOUT_A_REGISTRATION,
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
  it('is one entry, and each says what retires it', () => {
    const entries = Object.entries(PORTS_WITHOUT_A_REGISTRATION);
    expect(entries).toHaveLength(1);
    for (const [portName, reason] of entries) {
      expect(reason.length, `${portName} has no reason`).toBeGreaterThan(60);
      expect(reason, `${portName} does not say what retires it`).toMatch(/Retired by/i);
    }
  });
});
