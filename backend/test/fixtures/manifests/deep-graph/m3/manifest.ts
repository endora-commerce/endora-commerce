import { defineModuleManifest } from '@endora-commerce/contracts';

export const manifest = defineModuleManifest({
  id: 'm3',
  name: 'Deep Graph 3',
  version: '1.0.0',
  dependencies: ['m2'],
});
