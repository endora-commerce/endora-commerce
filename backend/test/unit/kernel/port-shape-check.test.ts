import { describe, expect, it } from 'vitest';
import { checkPortShape, type PortShapeInput } from '../../../scripts/check-port-shape.js';

/**
 * `check:port-shape` — the shapes it refuses, and the ones it must not (D-97.3).
 *
 * The rule is narrow on purpose: an optional **method** on a published port, or
 * on an interface widening one. Everything else optional in a contract is
 * ordinary — 34 optional members across the tree's ports are parameters and
 * data properties — so the discriminations below are as load-bearing as the
 * findings. Each case enters as source text, where a real run enters.
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

function input(over: Partial<PortShapeInput> = {}): PortShapeInput {
  return {
    contracts: new Map([[PORT_FILE, PUBLISHED_PORT]]),
    modules: new Map(),
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
