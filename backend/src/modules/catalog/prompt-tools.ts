import {
  SearchCategoriesParamsSchema,
  SearchProductsParamsSchema,
  type SearchCategoriesParams,
  type SearchProductsParams,
} from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import { CatalogAdminService, type CatalogEventBus } from './services/catalog-admin.service.js';
import { CategoryAdminService } from './services/category-admin.service.js';
import type { PromptActionTool } from '../prompt_actions/services/tool-registry.js';

/**
 * Catalog's contribution to the prompt-assistant tool catalogue
 * (feature 043, data-model §4). Resolvers only here — the bulk
 * category-assignment mutation lives in `prompt-tools.bulk.ts` wiring
 * (US2). Handlers delegate to the same admin services that back the
 * manual admin routes; descriptions are the LLM's only documentation
 * (tool-contribution contract rule 4).
 */

export interface CatalogPromptToolsDeps {
  emFactory: () => EntityManager;
  events: EventBus;
  auditLogService?: AuditLogService;
}

const RESULT_LIMIT = 20;

function localizedLabel(name: Record<string, string>): string {
  return name['en'] ?? Object.values(name)[0] ?? '(unnamed)';
}

export function catalogPromptResolverTools(deps: CatalogPromptToolsDeps): PromptActionTool[] {
  // Same cast catalog's own plugin performs when constructing this service.
  const adminService = new CatalogAdminService(
    deps.emFactory,
    deps.events as CatalogEventBus,
    deps.auditLogService,
  );
  const categoryService = new CategoryAdminService(deps.emFactory);

  const searchProducts: PromptActionTool<SearchProductsParams> = {
    id: 'catalog.search_products',
    moduleId: 'catalog',
    kind: 'resolver',
    description:
      'Search products by a name, SKU or slug fragment (case- and diacritic-insensitive substring). Returns up to 20 matches as {id, sku, label, status}. Use the returned id in mutation tools; never invent ids.',
    requiredPermission: 'catalog:read',
    paramsSchema: SearchProductsParamsSchema,
    execute: async (params) => {
      const result = await adminService.listProducts({
        q: params.q,
        pageSize: Math.min(params.limit ?? 10, RESULT_LIMIT),
      });
      return result.items.map((p) => ({
        id: p.id,
        sku: p.sku,
        label: localizedLabel(p.name),
        status: p.status,
      }));
    },
  };

  const searchCategories: PromptActionTool<SearchCategoriesParams> = {
    id: 'catalog.search_categories',
    moduleId: 'catalog',
    kind: 'resolver',
    description:
      'Search product categories by a name fragment (case-insensitive). Returns up to 20 matches as {id, label, slug}.',
    requiredPermission: 'catalog:read',
    paramsSchema: SearchCategoriesParamsSchema,
    execute: async (params) => {
      const all = await categoryService.listAll();
      const needle = params.q.toLowerCase();
      return all
        .filter((c) => {
          const labels = Object.values(c.name).join(' ').toLowerCase();
          return labels.includes(needle) || c.slug.toLowerCase().includes(needle);
        })
        .slice(0, RESULT_LIMIT)
        .map((c) => ({ id: c.id, label: localizedLabel(c.name), slug: c.slug }));
    },
  };

  return [searchProducts as PromptActionTool, searchCategories as PromptActionTool];
}
