// Library page — feature 013 / US2 / T069.
// Three-pane Magento-2-Media-Gallery–style layout: folder tree + asset grid
// + per-asset detail drawer. Inline upload affordance per current folder.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { useTranslation } from '@/i18n/useTranslation';
import { AssetUploader } from '@endora-commerce/admin-kit/components';
import { toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';
import { FolderTree } from '../components/FolderTree';
import { AssetDetailDrawer } from '../components/AssetDetailDrawer';
import {
  assetsLibraryClient,
  type AssetFolder,
  type AssetSummary,
} from '../api/assets-library-client';

export function LibraryPage(): ReactNode {
  const t = useTranslation('assets_library');
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null); // null = Unsorted (root)
  const [items, setItems] = useState<AssetSummary[]>([]);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const PAGE_SIZE = 60;

  const loadFolders = useCallback(async (): Promise<void> => {
    try {
      setFolders(await assetsLibraryClient.listFolders());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Debounce the search box so each keystroke does not fire a request; the
  // actual filtering is done server-side (see loadFirstPage), so the search
  // covers every asset in the folder, not only the ones already loaded.
  useEffect(() => {
    const h = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(h);
  }, [q]);

  // First page — replaces the list. Runs on folder change or a new search.
  const loadFirstPage = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const out = await assetsLibraryClient.listAssets({
        folderId,
        ...(debouncedQ ? { q: debouncedQ } : {}),
        limit: PAGE_SIZE,
      });
      setItems(out.data);
      setCursor(out.nextCursor);
      setHasMore(out.nextCursor !== null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [folderId, debouncedQ]);

  // Next page — appends, keyed off the server cursor.
  const loadMore = useCallback(async (): Promise<void> => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const out = await assetsLibraryClient.listAssets({
        folderId,
        ...(debouncedQ ? { q: debouncedQ } : {}),
        cursor,
        limit: PAGE_SIZE,
      });
      setItems((prev) => [...prev, ...out.data]);
      setCursor(out.nextCursor);
      setHasMore(out.nextCursor !== null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }, [folderId, debouncedQ, cursor, loadingMore]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);
  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  // Infinite scroll — auto-load the next page when the sentinel scrolls into
  // view. The "Load more" button remains as an explicit fallback.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  // Backwards-compatible alias — child callbacks call loadItems() to refresh.
  const loadItems = loadFirstPage;

  const onCreateFolder = async (parentId: string | null, name: string): Promise<void> => {
    try {
      await assetsLibraryClient.createFolder({ parentId, name });
      await loadFolders();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onRenameFolder = async (id: string, name: string): Promise<void> => {
    try {
      await assetsLibraryClient.patchFolder(id, { name });
      await loadFolders();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDeleteFolder = async (id: string): Promise<void> => {
    try {
      const choice = window.confirm(
        t('folders.deleteConfirm'),
      );
      if (!choice) return;
      const out = await assetsLibraryClient.deleteFolder(id, {
        ifNonEmpty: 'moveContentsToParent',
      });
      setInfo(t('folders.removed', { id: out.deletedFolderId }));
      if (folderId === id) setFolderId(null);
      await loadFolders();
      await loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('page.title')}
        description={t('page.description')}
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert>
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-12 gap-4">
        {/* Folder tree */}
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle className="text-base">{t('folders.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <FolderTree
              folders={folders}
              selectedId={folderId}
              onSelect={setFolderId}
              onCreate={onCreateFolder}
              onRename={onRenameFolder}
              onDelete={onDeleteFolder}
            />
          </CardContent>
        </Card>

        {/* Grid */}
        <Card className={selected ? 'col-span-6' : 'col-span-9'}>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">{t('assets.title')}</CardTitle>
            <div className="flex items-center gap-2">
              <Input
                value={q}
                onChange={(e): void => setQ(e.target.value)}
                onKeyDown={(e): void => {
                  if (e.key === 'Enter') setDebouncedQ(q);
                }}
                placeholder={t('assets.searchPlaceholder')}
                className="w-64"
              />
              <Button type="button" variant="outline" size="sm" onClick={(): void => setDebouncedQ(q)}>
                {t('common.search')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <AssetUploader
              defaults={{ folderId }}
              triggerLabel={t('uploader.triggerCurrentFolder')}
              onUploaded={(): void => {
                void loadItems();
              }}
            />

            {loading ? (
              <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('assets.emptyFolder')}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {items.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`group overflow-hidden rounded-md border bg-muted/30 p-2 text-left transition hover:border-primary ${
                      selected === a.id ? 'border-primary ring-2 ring-primary/30' : ''
                    }`}
                    onClick={() => setSelected(a.id)}
                  >
                    {a.mimeType.startsWith('image/') ? (
                      // eslint-disable-next-line jsx-a11y/alt-text
                      <img
                        src={toAbsoluteAssetUrl(a.url)}
                        loading="lazy"
                        className="aspect-square w-full rounded object-cover"
                      />
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                        {a.mimeType}
                      </div>
                    )}
                    <div className="mt-1 truncate text-xs">{a.label ?? a.filename}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {a.visibility} · {Number(a.sizeBytes)}B
                    </div>
                  </button>
                ))}
              </div>
            )}

            {!loading && hasMore ? (
              <div ref={sentinelRef} className="flex justify-center pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loadingMore}
                  onClick={(): void => void loadMore()}
                >
                  {loadingMore ? t('common.loading') : t('assets.loadMore')}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {selected ? (
          <div className="col-span-3">
            <AssetDetailDrawer
              assetId={selected}
              onChanged={(): void => {
                void loadItems();
              }}
              onClose={(): void => setSelected(null)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
