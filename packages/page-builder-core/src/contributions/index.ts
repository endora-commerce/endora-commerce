// `@endora-commerce/page-builder-core/contributions` — what a module's Page
// Builder renderers are contributed in, and the pure steps a surface composes
// them with (`specs/141-module-block-renderers/contracts/block-renderers.md`).

export type {
  BlockPresence,
  BlockRenderEnvironment,
  PageBuilderBlockEditorConfig,
  StorefrontBlockConfig,
  StorefrontContributions,
} from './types.js';

export { BlockRenderEnvironmentProvider, useBlockRenderEnvironment } from './environment.js';

export {
  isOwnerPresent,
  withContributedBlocks,
  withPresence,
  type BlockContributionEntry,
  type ContributedBlocksResult,
  type IgnoredBlockContribution,
} from './compose.js';

export { fieldsFromDescriptor, type DescriptorFieldSource } from './fields-from-descriptor.js';

export { withBlockBoundary } from './block-boundary.js';
