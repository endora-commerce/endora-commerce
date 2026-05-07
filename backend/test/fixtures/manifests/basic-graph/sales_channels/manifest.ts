import { defineModuleManifest } from '@b2b/contracts';

export const manifest = defineModuleManifest({
  id: 'sales_channels',
  name: 'Sales Channels',
  version: '1.0.0',
  dependencies: ['settings'],
});
