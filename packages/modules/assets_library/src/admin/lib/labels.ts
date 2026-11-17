import { defineEnumLabels } from '@endora-commerce/admin-kit/lib';
import type { AssetReferenceKind, AssetVisibility } from '@endora-commerce/contracts';

/**
 * What points at an asset, as the detail drawer's "Referenced by" list names it
 * (issue #1434). The kinds are the published `AssetReferenceKind` union, so a
 * kind added there is a type error here until it has a label. Keys are in the
 * `assets_library` bundle.
 */
export const assetReferenceKindLabels = defineEnumLabels<AssetReferenceKind>({
  product_gallery: 'detail.referenceKind.product_gallery',
  product_attachment: 'detail.referenceKind.product_attachment',
  product_virtual_download: 'detail.referenceKind.product_virtual_download',
  category_main_image: 'detail.referenceKind.category_main_image',
  category_content: 'detail.referenceKind.category_content',
  cms_body_embed: 'detail.referenceKind.cms_body_embed',
  megamenu_item_target: 'detail.referenceKind.megamenu_item_target',
  blog_category_main_image: 'detail.referenceKind.blog_category_main_image',
  blog_post_main_image: 'detail.referenceKind.blog_post_main_image',
  blog_post_content: 'detail.referenceKind.blog_post_content',
  blog_category_description: 'detail.referenceKind.blog_category_description',
  crm_opportunity_attachment: 'detail.referenceKind.crm_opportunity_attachment',
  project_attachment: 'detail.referenceKind.project_attachment',
  task_attachment: 'detail.referenceKind.task_attachment',
  admin_user_avatar: 'detail.referenceKind.admin_user_avatar',
  product_content: 'detail.referenceKind.product_content',
});

/**
 * An asset's visibility, as the detail drawer's badge and its "Change…" dialog
 * name it (issue #1575). Keys are in the `assets_library` bundle.
 */
export const assetVisibilityLabels = defineEnumLabels<AssetVisibility>({
  public: 'visibility.public',
  private: 'visibility.private',
});
