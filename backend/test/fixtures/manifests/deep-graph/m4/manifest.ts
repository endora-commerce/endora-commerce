import { defineModuleManifest } from '@b2b/contracts';

export const manifest = defineModuleManifest({
  id: 'm4',
  name: 'Deep Graph 4',
  version: '1.0.0',
  dependencies: ['m3'],
});
