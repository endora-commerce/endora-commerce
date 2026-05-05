// Library page — feature 013 / US2 / T069.
// Three-pane Magento-2-Media-Gallery–style layout: folder tree + asset grid
// + per-asset detail drawer. Inline upload affordance per current folder.

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { FolderTree } from '../components/FolderTree';
import { AssetUploader } from '../components/AssetUploader';
import { AssetDetailDrawer } from '../components/AssetDetailDrawer';
import {
  assetsLibraryClient,
  type AssetFolder,
  type AssetSummary,
} from '../api/assets-library-client';

export function LibraryPage(): ReactNode {
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null); // null = Unsorted (root)
  const [items, setItems] = useState<AssetSummary[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const loadFolders = useCallback(async (): Promise<void> => {
    try {
      setFolders(await assetsLibraryClient.listFolders());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadItems = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const out = await assetsLibraryClient.listAssets({
        folderId,
        ...(q ? { q } : {}),
        limit: 60,
      });
      setItems(out.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [folderId, q]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);
  useEffect(() => {
    void loadItems();
  }, [loadItems]);

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
        'Delete this folder?\n\n' +
          'OK = move its contents to the parent folder, then delete.\n' +
          'Cancel = abort.',
      );
      if (!choice) return;
      const out = await assetsLibraryClient.deleteFolder(id, {
        ifNonEmpty: 'moveContentsToParent',
      });
      setInfo(`Folder removed (${out.deletedFolderId}).`);
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
        title="Assets Library"
        description="Upload, organize, and reuse images, videos, PDFs, and other files across the platform."
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
            <CardTitle className="text-base">Folders</CardTitle>
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
            <CardTitle className="text-base">Assets</CardTitle>
            <div className="flex items-center gap-2">
              <Input
                value={q}
                onChange={(e): void => setQ(e.target.value)}
                onKeyDown={(e): void => {
                  if (e.key === 'Enter') void loadItems();
                }}
                placeholder="Search filename or label…"
                className="w-64"
              />
              <Button type="button" variant="outline" size="sm" onClick={(): void => void loadItems()}>
                Search
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <AssetUploader
              defaults={{ folderId }}
              triggerLabel="Upload to current folder"
              onUploaded={(): void => {
                void loadItems();
              }}
            />

            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No assets in this folder yet.
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
                        src={a.url}
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
