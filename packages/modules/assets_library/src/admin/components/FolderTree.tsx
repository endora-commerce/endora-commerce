// Folder tree — feature 013 / US2 / T067.
// Renders the Library's folder hierarchy with create/rename/delete actions.

import { useMemo, useState, type ReactNode } from 'react';
import { Folder, FolderPlus, Trash2 } from 'lucide-react';
import { Button, Input } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { AssetFolder } from '../api/assets-library-client.js';

export interface FolderTreeProps {
  folders: AssetFolder[];
  selectedId: string | null;
  /** null ⇒ Unsorted (root). */
  onSelect: (id: string | null) => void;
  onCreate: (parentId: string | null, name: string) => Promise<void> | void;
  onRename: (id: string, name: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
}

interface NodeRow {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
}

function flatten(
  folders: AssetFolder[],
  parentId: string | null,
  depth: number,
): NodeRow[] {
  const rows: NodeRow[] = [];
  const children = folders
    .filter((f) => (f.parentId ?? null) === parentId)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  for (const c of children) {
    rows.push({ id: c.id, name: c.name, parentId: c.parentId ?? null, depth });
    rows.push(...flatten(folders, c.id, depth + 1));
  }
  return rows;
}

export function FolderTree(props: FolderTreeProps): ReactNode {
  const t = useTranslation('assets_library');
  const [creatingFor, setCreatingFor] = useState<string | null | undefined>(undefined);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');

  const rows = useMemo(() => flatten(props.folders, null, 0), [props.folders]);

  return (
    <div className="space-y-1">
      <button
        type="button"
        className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-muted ${
          props.selectedId === null ? 'bg-muted font-medium' : ''
        }`}
        onClick={() => props.onSelect(null)}
      >
        <span className="flex items-center gap-2">
          <Folder className="size-4" />
          {t('folders.root')}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={(e): void => {
            e.stopPropagation();
            setCreatingFor(null);
            setNewName('');
          }}
        >
          <FolderPlus className="size-4" />
        </Button>
      </button>

      {creatingFor === null ? (
        <InlineCreator
          value={newName}
          onChange={setNewName}
          onConfirm={async () => {
            if (newName.trim().length === 0) return;
            await props.onCreate(null, newName.trim());
            setCreatingFor(undefined);
            setNewName('');
          }}
          onCancel={() => {
            setCreatingFor(undefined);
            setNewName('');
          }}
          depth={1}
          placeholder={t('folders.namePlaceholder')}
          confirmLabel={t('common.ok')}
          cancelLabel={t('common.cancel')}
        />
      ) : null}

      {rows.map((r) => (
        <div key={r.id}>
          {renamingId === r.id ? (
            <InlineCreator
              value={renameName}
              onChange={setRenameName}
              onConfirm={async () => {
                if (renameName.trim().length === 0) return;
                await props.onRename(r.id, renameName.trim());
                setRenamingId(null);
              }}
              onCancel={() => setRenamingId(null)}
              depth={r.depth}
              placeholder={t('folders.namePlaceholder')}
              confirmLabel={t('common.ok')}
              cancelLabel={t('common.cancel')}
            />
          ) : (
            <div
              className={`group flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-muted ${
                props.selectedId === r.id ? 'bg-muted font-medium' : ''
              }`}
              style={{ paddingLeft: `${0.5 + r.depth * 1.25}rem` }}
            >
              <button
                type="button"
                className="flex flex-1 items-center gap-2 text-left"
                onClick={() => props.onSelect(r.id)}
                onDoubleClick={() => {
                  setRenamingId(r.id);
                  setRenameName(r.name);
                }}
              >
                <Folder className="size-4" />
                <span className="truncate">{r.name}</span>
              </button>
              <div className="opacity-0 transition group-hover:opacity-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  title={t('folders.newSubfolder')}
                  onClick={(): void => {
                    setCreatingFor(r.id);
                    setNewName('');
                  }}
                >
                  <FolderPlus className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  title={t('common.delete')}
                  onClick={(): void => {
                    void props.onDelete(r.id);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          )}
          {creatingFor === r.id ? (
            <InlineCreator
              value={newName}
              onChange={setNewName}
              onConfirm={async () => {
                if (newName.trim().length === 0) return;
                await props.onCreate(r.id, newName.trim());
                setCreatingFor(undefined);
                setNewName('');
              }}
              onCancel={() => {
                setCreatingFor(undefined);
                setNewName('');
              }}
              depth={r.depth + 1}
              placeholder={t('folders.namePlaceholder')}
              confirmLabel={t('common.ok')}
              cancelLabel={t('common.cancel')}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function InlineCreator({
  value,
  onChange,
  onConfirm,
  onCancel,
  depth,
  placeholder,
  confirmLabel,
  cancelLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
  depth: number;
  placeholder: string;
  confirmLabel: string;
  cancelLabel: string;
}): ReactNode {
  return (
    <div
      className="flex items-center gap-1 px-2 py-1"
      style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
    >
      <Input
        autoFocus
        value={value}
        onChange={(e): void => onChange(e.target.value)}
        onKeyDown={(e): void => {
          if (e.key === 'Enter') void onConfirm();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={placeholder}
      />
      <Button type="button" size="sm" onClick={(): void => void onConfirm()}>
        {confirmLabel}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        {cancelLabel}
      </Button>
    </div>
  );
}
