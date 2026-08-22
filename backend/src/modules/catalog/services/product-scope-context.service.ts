import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  LanguageReadPort,
  ProductEditorPreferenceFields,
  ProductScopeChannel,
  ProductScopeContextResponse,
} from '@b2b/contracts';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';

import type { SalesChannelMembershipPort } from '../../../kernel/ports/sales-channel.js';
import { Product } from '../entities/product.entity.js';
import { ProductEditorPreference } from '../entities/product-editor-preference.entity.js';
import type { ProductEditorPreferencesService } from './product-editor-preferences.service.js';

/**
 * Feature 022 — assembles the response of
 * `GET /admin/products/:id/scope-context`.
 *
 * Combines:
 *   - the product's assigned channels (via SalesChannelMembershipPort),
 *     each carrying its language list (`SalesChannel.languages` JSONB),
 *   - the union of those languages,
 *   - the platform's primary admin language (LanguageService.getDefault()),
 *   - the editor's remembered context (ProductEditorPreference).
 *
 * If the product has zero assigned channels, `languagesUnion` falls
 * back to every active platform language so the editor can still
 * translate the global baseline.
 */
export class ProductScopeContextService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly salesChannelMembership: SalesChannelMembershipPort,
    private readonly languageService: LanguageReadPort,
    private readonly editorPreferences: ProductEditorPreferencesService,
  ) {}

  async getContext(
    productId: string,
    adminUserId: string,
  ): Promise<ProductScopeContextResponse> {
    const em = this.emFactory();

    // 1. Ensure the product exists (or surface a clean 404).
    const product = await em.findOne(Product, { id: productId });
    if (!product) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Product not found.');
    }

    // 2. Channels the product is assigned to. Each channel carries its
    //    language list directly on the entity.
    const channels = await this.salesChannelMembership.listChannelsForEntity(
      'product',
      productId,
    );

    const channelDtos: ProductScopeChannel[] = channels
      .map((c) => {
        const name =
          (typeof c.name === 'object' && c.name !== null
            ? Object.values(c.name).find((v) => typeof v === 'string' && v.length > 0)
            : null) ?? c.code;
        return {
          id: c.id,
          code: c.code,
          name,
          languages: [...c.languages].sort(),
          isDefault: c.systemDefault,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    // 3. Union of channel languages. When the product is in zero
    //    channels, fall back to every active platform language so the
    //    editor still has a viable language list.
    let languagesUnion: string[];
    if (channelDtos.length === 0) {
      const activeLangs = await this.languageService.listActive();
      languagesUnion = activeLangs.map((l) => l.code).sort();
    } else {
      const unionSet = new Set<string>();
      for (const c of channelDtos) for (const code of c.languages) unionSet.add(code);
      languagesUnion = [...unionSet].sort();
    }

    // 4. Primary admin language — default Language row if present, else
    //    the first available active language, else 'en' as a last resort.
    const defaultLang = await this.languageService.getDefault();
    let primaryAdminLanguage = defaultLang?.code;
    if (!primaryAdminLanguage) {
      const actives = await this.languageService.listActive();
      primaryAdminLanguage = actives[0]?.code ?? 'en';
    }

    // 5. Editor preference — null if no prior visit.
    const pref = await this.editorPreferences.find(adminUserId, productId);
    const preference: ProductEditorPreferenceFields | null = pref
      ? { lastChannelId: pref.lastChannelId ?? null, lastLanguageCode: pref.lastLanguageCode ?? null }
      : null;

    return {
      productId,
      channels: channelDtos,
      languagesUnion,
      primaryAdminLanguage,
      preference,
    };
  }

  /**
   * Validate that a remembered preference is still applicable for the
   * given product. Used by the PUT editor-preference endpoint.
   */
  async assertChannelAssignedToProduct(
    productId: string,
    channelId: string,
  ): Promise<void> {
    const channels = await this.salesChannelMembership.listChannelsForEntity(
      'product',
      productId,
    );
    if (!channels.some((c) => c.id === channelId)) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'channel_not_assigned_to_product',
        [{ path: 'lastChannelId', issue: channelId }],
      );
    }
  }

  /** Re-export for tests + consumers needing direct entity access. */
  preferenceEntityClass(): typeof ProductEditorPreference {
    return ProductEditorPreference;
  }
}
