import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { checkContractTarget } from '../../src/overlay/check-core-contracts.js';
import { coreSampleRoot, overlayRoot } from './_fixtures.js';

const interfaceFilePath = join(
  coreSampleRoot,
  'price_lists/services/pricing-service.interface.ts',
);

describe('check-core-contracts — build-time contract gate (T009, FR-003/SC-004)', () => {
  it('passes when the overlay satisfies the core interface', () => {
    const messages = checkContractTarget({
      overlayFilePath: join(overlayRoot('overlay-good'), 'price_lists/services/pricing-service.ts'),
      overlayExportName: 'PricingService',
      interfaceFilePath,
      interfaceName: 'PricingServiceContract',
    });
    expect(messages).toEqual([]);
  });

  it('fails when the overlay violates the core interface', () => {
    const messages = checkContractTarget({
      overlayFilePath: join(
        overlayRoot('overlay-bad-contract'),
        'price_lists/services/pricing-service.ts',
      ),
      overlayExportName: 'PricingService',
      interfaceFilePath,
      interfaceName: 'PricingServiceContract',
    });
    expect(messages.length).toBeGreaterThan(0);
  });
});
