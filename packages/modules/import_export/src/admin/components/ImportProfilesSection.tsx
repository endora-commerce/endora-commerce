import { useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ImportProfile } from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { cn } from '@endora-commerce/admin-kit/lib';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { deleteProfile, errorMessage } from './import-profiles-api.js';
import { ImportProfileDialog } from './ImportProfileDialog.js';

/**
 * The **Import profiles** section of the import/export centre (feature 174,
 * `contracts/import-profiles-and-csv.md` §4): the list, the create / edit dialog and a delete
 * that asks first. The page mounts it only for an operator holding `catalog:write`, the code
 * every profile route is gated by, and owns the list so the products import step reads the
 * same one.
 */

/** What the products import reaches the section through (issue #1528). */
export interface ImportProfilesSectionHandle {
  /** Expands the section and moves focus to its heading, which scrolls it into view. */
  reveal: () => void;
  /** Expands the section and opens the create dialog. */
  create: () => void;
}

export interface ImportProfilesSectionProps {
  profiles: ImportProfile[];
  loading: boolean;
  loadError: boolean;
  onChanged: () => void;
  ref?: Ref<ImportProfilesSectionHandle>;
}

export function ImportProfilesSection({
  profiles,
  loading,
  loadError,
  onChanged,
  ref,
}: ImportProfilesSectionProps): ReactNode {
  const t = useTranslation('import_export');
  const titleId = useId();
  const contentId = useId();
  const describedId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Collapsed by default (issue #1528): the profiles are a prerequisite set up once, not the
  // page's work, and the products import links here when it needs them.
  const [expanded, setExpanded] = useState(false);
  const [focusRequested, setFocusRequested] = useState(false);
  // A list that cannot be read opens the section, so its retry is not hidden.
  useEffect(() => {
    if (loadError) setExpanded(true);
  }, [loadError]);
  useEffect(() => {
    if (!focusRequested) return;
    setFocusRequested(false);
    toggleRef.current?.focus();
    toggleRef.current?.scrollIntoView?.({ block: 'start' });
  }, [focusRequested]);
  const [editing, setEditing] = useState<ImportProfile | 'new' | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      reveal: (): void => {
        setExpanded(true);
        setFocusRequested(true);
      },
      create: (): void => {
        setExpanded(true);
        setEditing('new');
      },
    }),
    [],
  );
  const [deleting, setDeleting] = useState<ImportProfile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteProfile(deleting.id);
      setDeleting(null);
      onChanged();
    } catch (err) {
      setDeleteError(errorMessage(err, t, 'importProfiles.error.delete'));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle id={titleId}>
            <button
              ref={toggleRef}
              type="button"
              aria-expanded={expanded}
              aria-controls={expanded ? contentId : undefined}
              onClick={(): void => setExpanded((open) => !open)}
              className="-mx-1 inline-flex items-center gap-1.5 rounded-sm px-1 text-left max-lg:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown
                aria-hidden="true"
                className={cn('size-4 shrink-0 transition-transform motion-reduce:transition-none', !expanded && '-rotate-90')}
              />
              {t('importProfiles.title')}
            </button>
          </CardTitle>
          <CardDescription>{t('importProfiles.description')}</CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(): void => {
            setExpanded(true);
            setEditing('new');
          }}
        >
          <Plus />
          {t('importProfiles.create')}
        </Button>
      </CardHeader>
      {expanded ? (
        <CardContent id={contentId} className="space-y-3">
          <p role="status" className={loading ? 'text-sm text-muted-foreground' : 'sr-only'}>
            {loading ? t('importProfiles.loading') : ''}
          </p>
          {loadError ? (
            <Alert variant="destructive">
              <AlertDescription>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex-1">{t('importProfiles.error.load')}</span>
                  <Button type="button" variant="outline" size="sm" className="max-lg:min-h-11" onClick={onChanged} disabled={loading}>
                    {t('importProfiles.retry')}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
          {!loading && !loadError && profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('importProfiles.empty')}</p>
          ) : null}
          {profiles.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('importProfiles.column.name')}</TableHead>
                  <TableHead>{t('importProfiles.column.sourceLanguageForGlobal')}</TableHead>
                  <TableHead>{t('importProfiles.column.mappings')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('importProfiles.column.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((profile) => (
                  <TableRow key={profile.id}>
                    <TableCell className="font-medium">{profile.name}</TableCell>
                    <TableCell>
                      {profile.sourceLanguageForGlobal ?? (
                        <span className="text-muted-foreground">{t('importProfiles.noGlobalSource')}</span>
                      )}
                    </TableCell>
                    <TableCell>{profile.localeMapping.length}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="max-lg:min-h-11 max-lg:min-w-11"
                          aria-label={t('importProfiles.editNamed', { name: profile.name })}
                          onClick={(): void => setEditing(profile)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="max-lg:min-h-11 max-lg:min-w-11"
                          aria-label={t('importProfiles.deleteNamed', { name: profile.name })}
                          onClick={(): void => {
                            setDeleteError(null);
                            setDeleting(profile);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      ) : null}

      {editing !== null ? (
        <ImportProfileDialog
          profile={editing === 'new' ? null : editing}
          onClose={(): void => setEditing(null)}
          onSaved={(): void => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}

      {deleting !== null ? (
        <ModalDialog
          title={t('importProfiles.delete.title')}
          onClose={(): void => setDeleting(null)}
          busy={deleteBusy}
          aria-describedby={describedId}
          footer={
            <>
              <Button type="button" variant="outline" onClick={(): void => setDeleting(null)} disabled={deleteBusy}>
                {t('importProfiles.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deleteBusy}
                onClick={(): void => {
                  void confirmDelete();
                }}
              >
                {t('importProfiles.delete.confirm')}
              </Button>
            </>
          }
        >
          <p id={describedId} className="text-sm">
            {t('importProfiles.delete.body', { name: deleting.name })}
          </p>
          {deleteError ? (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          ) : null}
        </ModalDialog>
      ) : null}
    </Card>
  );
}
