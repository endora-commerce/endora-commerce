'use client';

import type { StorefrontContributions } from '@endora-commerce/page-builder-core/contributions';

/**
 * Page Builder blocks **this storefront** renders itself.
 *
 * This file is yours. It is written empty by the scaffold and nothing
 * regenerates it.
 *
 * Use it for a block no installed package draws — typically one your own
 * overlay module declares in its manifest. Key each renderer by the persisted
 * block name, `<moduleId>.<Name>`, exactly as the manifest declares it:
 *
 * ```tsx
 * export const localBlocks: StorefrontContributions['blocks'] = {
 *   'my_overlay.Banner': {
 *     render: ({ text }: { text?: string }) => <aside>{text}</aside>,
 *   },
 * };
 * ```
 *
 * A renderer here runs on the server and again on hydration, so it is
 * synchronous, reads no browser global during render, and injects HTML only
 * through `sanitizeRichHtml` from `@endora-commerce/cms-components`. It never
 * replaces a block an installed package or the platform already draws: a name
 * that is already rendered is kept, and this entry is ignored with a warning.
 *
 * A module **package** needs no line here — `pnpm add` it and
 * `blocks:generate` (run by `dev` and `build`) registers its renderers.
 */
export const localBlocks: StorefrontContributions['blocks'] = {};
