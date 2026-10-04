/**
 * The admin layer — declarations only. Each block contribution is a
 * dynamic-import factory, so the registry that names this file is enumerable
 * without evaluating an editor renderer.
 */
import type { AdminContributions } from '@endora-commerce/contracts';

export const contributions: AdminContributions = {
  blocks: [
    {
      name: 'acceptance_blocks.Badge',
      context: 'cms',
      component: () => import('./badge-editor.js'),
    },
    {
      name: 'acceptance_blocks.Badge',
      context: 'email',
      component: () => import('./badge-email.js'),
    },
  ],
};
