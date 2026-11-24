import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminI18nTranslatePort, SupportedAdminLanguage } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import { AdminActionsService } from '../../../../packages/modules/admin_actions/src/backend/services/admin-actions-service.js';
import { manifest as salesChannelsManifest } from '../../../../packages/modules/sales_channels/src/manifest.js';
import enBundle from '../../../../packages/modules/sales_channels/i18n/en.json' with { type: 'json' };
import plBundle from '../../../../packages/modules/sales_channels/i18n/pl.json' with { type: 'json' };

/**
 * Owner-reported: the ⌘K palette did not find the Sales channels screen
 * (`Kanały sprzedaży`). Constitution XVI.
 *
 * The client half — what an operator can type — is
 * `admin/test/components/AppShell.palette-sales-channels.test.tsx`. This is the
 * server half: the rows `module_actions` holds for this module are exactly what
 * the manifest declares (the reconciler copies them verbatim), and the service
 * serves the roster to an operator holding `sales_channels:read` — labelled in
 * the operator's language — and to nobody without it, so the palette never
 * advertises a 403.
 */

const BUNDLES: Record<string, Record<string, string>> = { en: enBundle, pl: plBundle };

function manifestRows(): unknown[] {
  return (salesChannelsManifest.actions ?? []).map((action) => ({
    module_id: salesChannelsManifest.id,
    action_id: action.id,
    label_key: action.labelKey,
    description_key: action.descriptionKey ?? null,
    icon: action.icon,
    target_route: action.targetRoute,
    required_permission: action.requiredPermission ?? null,
    keywords: [...(action.keywords ?? [])],
    weight: action.weight ?? 100,
    version: 1,
  }));
}

function emReturning(rows: unknown[]): () => EntityManager {
  return () => ({ execute: async (): Promise<unknown[]> => rows }) as unknown as EntityManager;
}

const i18n: AdminI18nTranslatePort = {
  translate: async (moduleId, key, language) =>
    BUNDLES[language]?.[key] ?? `${moduleId}.${key}`,
};

async function served(
  granted: readonly string[],
  language: SupportedAdminLanguage,
): Promise<Array<{ actionId: string; label: string; targetRoute: string }>> {
  const service = new AdminActionsService({
    em: emReturning(manifestRows()),
    i18nService: i18n,
    permissionService: { listPermissions: async () => [...granted] },
  });
  try {
    const { actions } = await service.listVisibleForOperator({ language, adminUserId: 'admin-1' });
    return actions.map((a) => ({ actionId: a.actionId, label: a.label, targetRoute: a.targetRoute }));
  } finally {
    service.dispose();
  }
}

describe('palette — the Sales channels roster is served by permission (Constitution XVI)', () => {
  it('serves the roster, in Polish, to an operator holding sales_channels:read', async () => {
    expect(await served(['sales_channels:read'], 'pl')).toEqual([
      { actionId: 'open-sales-channels', label: 'Kanały sprzedaży', targetRoute: '/sales-channels' },
    ]);
  });

  it('serves the roster, in English, to an operator holding sales_channels:read', async () => {
    expect(await served(['sales_channels:read'], 'en')).toEqual([
      { actionId: 'open-sales-channels', label: 'Sales channels', targetRoute: '/sales-channels' },
    ]);
  });

  it('adds the create form for sales_channels:write and serves both to a platform admin', async () => {
    expect((await served(['sales_channels:read', 'sales_channels:write'], 'pl')).map((a) => a.actionId).sort())
      .toEqual(['new-sales-channel', 'open-sales-channels']);
    expect((await served(['*'], 'en')).map((a) => a.actionId).sort())
      .toEqual(['new-sales-channel', 'open-sales-channels']);
  });

  it('serves nothing to an operator without a sales_channels code', async () => {
    expect(await served(['orders:read', 'catalog:read'], 'pl')).toEqual([]);
  });
});
