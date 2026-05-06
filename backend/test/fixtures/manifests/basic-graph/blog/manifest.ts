import { defineModuleManifest } from '@b2b/contracts';

export const manifest = defineModuleManifest({
  id: 'blog',
  name: 'Blog',
  version: '1.0.0',
  dependencies: ['settings', 'sales_channels'],
});
