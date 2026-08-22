import { defineModuleManifest } from '@endora-commerce/contracts';

export const manifest = defineModuleManifest({
  id: 'm2',
  name: 'Deep Graph 2',
  version: '1.0.0',
  dependencies: ['m1'],
});
