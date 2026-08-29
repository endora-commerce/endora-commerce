/** Minimal catalog shapes for CMS storefront fetch — avoids @endora-commerce/contracts in this package. */
export interface CmsProductSummary {
  id: string;
  slug: string;
  name: string;
  sku: string;
  primaryAssetUrl: string | null;
  price: { amount: number; currency: string } | null;
  stockLevel: number | null;
}

export interface CmsCategoryNode {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  productCount: number;
  children: CmsCategoryNode[];
}
