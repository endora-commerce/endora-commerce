import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { checkContractTarget } from '../../src/overlay/check-core-contracts.js';
import { coreSampleRoot, overlayRoot } from './_fixtures.js';

// US1 scenario 4 (SC-004): an overlay that does not satisfy the core service
// interface fails the build-time contract check — no silent divergence.
describe('US1 — contract-violating overlay fails the build (T022)', () => {
  const interfaceFilePath = join(
    coreSampleRoot,
    'price_lists/services/pricing-service.interface.ts',
  );

  it('a valid overlay passes; a violating overlay is rejected', () => {
    const good = checkContractTarget({
      overlayFilePath: join(overlayRoot('overlay-good'), 'price_lists/services/pricing-service.ts'),
      overlayExportName: 'PricingService',
      interfaceFilePath,
      interfaceName: 'PricingServiceContract',
    });
    expect(good).toEqual([]);

    const bad = checkContractTarget({
      overlayFilePath: join(
        overlayRoot('overlay-bad-contract'),
        'price_lists/services/pricing-service.ts',
      ),
      overlayExportName: 'PricingService',
      interfaceFilePath,
      interfaceName: 'PricingServiceContract',
    });
    expect(bad.length).toBeGreaterThan(0);
  });
});
