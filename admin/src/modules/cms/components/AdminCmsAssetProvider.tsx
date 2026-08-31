'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Data } from '@measured/puck';
import { CmsRenderProvider, walkAssetIds, type CmsRenderEmbeds } from '@endora-commerce/cms-components';
import { fetchAssetDetail } from '@endora-commerce/admin-kit/components';
import { toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';

const apiBaseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';

export function AdminCmsAssetProvider({
  embeds,
  data,
  children,
}: {
  embeds: CmsRenderEmbeds;
  data: Data;
  children: ReactNode;
}): React.ReactElement {
  const [assets, setAssets] = useState<
    Record<string, { url: string; mimeType?: string; filename?: string; label?: string | null }>
  >({});

  const assetIds = useMemo(() => Array.from(walkAssetIds(data)).sort().join(','), [data]);

  useEffect(() => {
    const ids = assetIds.length > 0 ? assetIds.split(',') : [];
    if (ids.length === 0) {
      setAssets({});
      return;
    }

    let cancelled = false;
    void (async (): Promise<void> => {
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            const detail = await fetchAssetDetail(id);
            return [
              id,
              {
                url: toAbsoluteAssetUrl(detail.url),
                mimeType: detail.mimeType,
                filename: detail.filename,
                label: detail.label ?? null,
              },
            ] as const;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const next: Record<string, { url: string; mimeType?: string; filename?: string; label?: string | null }> =
        {};
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1];
      }
      setAssets(next);
    })();

    return (): void => {
      cancelled = true;
    };
  }, [assetIds]);

  return (
    <CmsRenderProvider embeds={embeds} assets={assets} mediaBaseUrl={apiBaseUrl.replace(/\/+$/, '')}>
      {children}
    </CmsRenderProvider>
  );
}
