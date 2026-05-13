import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ChevronDown, ChevronRight, Copy, Check, Search } from 'lucide-react';
import type {
  SalesChannelSummary,
  SetValueRequest,
  SettingDto,
  SettingGroupDto,
} from '@b2b/contracts';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { settingsClient } from '../api/settings-client';
import { salesChannelsClient } from '@/modules/sales_channels/api/sales-channels-client';
import { useTranslation } from '@/i18n/useTranslation';
import { ConflictBanner } from '../components/ConflictBanner';
import { SettingValueEditor } from '../components/SettingValueEditor';

/**
 * Settings page — feature 004 / US2.
 *
 * Lists every registered group with its settings. Selecting a setting opens
 * an inline editor; saving applies the value to all sales channels in scope
 * or to a chosen subset, with optimistic-concurrency conflict handling.
 */
export function SettingsPage(): ReactNode {
  const t = useTranslation('settings');
  const [groups, setGroups] = useState<SettingGroupDto[]>([]);
  const [allChannels, setAllChannels] = useState<SalesChannelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSetting, setSelectedSetting] = useState<SettingDto | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [list, channels] = await Promise.all([
        settingsClient.list(),
        salesChannelsClient.list({ activeOnly: false, pageSize: 200 }).catch(() => ({ items: [] as SalesChannelSummary[] })),
      ]);
      setGroups(list.groups);
      setAllChannels(channels.items);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.envelope.error.message : 'Failed to load settings.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const allChannelCodes = useMemo(
    () => mergeChannelCodes(groups, allChannels),
    [groups, allChannels],
  );

  const reloadSelected = useCallback(async (): Promise<void> => {
    if (!selectedSetting) return;
    try {
      const fresh = await settingsClient.getByCode(selectedSetting.code);
      setSelectedSetting(fresh);
      setConflict(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.envelope.error.message : 'Failed to reload setting.',
      );
    }
  }, [selectedSetting]);

  const onSubmit = useCallback(
    async (body: SetValueRequest & { expectedVersion?: string }): Promise<void> => {
      if (!selectedSetting) return;
      setSaving(true);
      setConflict(null);
      const expectedVersion = computeVersion(selectedSetting);
      try {
        await settingsClient.setValue(selectedSetting.code, {
          ...body,
          expectedVersion,
        });
        await refresh();
        await reloadSelected();
      } catch (err) {
        if (err instanceof ApiError && err.envelope.error.code === 'VERSION_CONFLICT') {
          setConflict(err.envelope.error.message);
        } else {
          setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
        }
      } finally {
        setSaving(false);
      }
    },
    [refresh, reloadSelected, selectedSetting],
  );

  const onReset = useCallback(async (): Promise<void> => {
    if (!selectedSetting) return;
    if (!confirm(`Reset all per-channel values for "${selectedSetting.code}"?`)) return;
    setSaving(true);
    try {
      await settingsClient.resetValues(selectedSetting.code);
      await refresh();
      await reloadSelected();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Reset failed.');
    } finally {
      setSaving(false);
    }
  }, [refresh, reloadSelected, selectedSetting]);

  const filteredGroups = useMemo(
    () => filterGroupsBySearch(groups, search),
    [groups, search],
  );

  const allCollapsed = useMemo(
    () => filteredGroups.length > 0 && filteredGroups.every((g) => collapsed[g.code]),
    [collapsed, filteredGroups],
  );

  const toggleGroup = (code: string): void => {
    setCollapsed((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  const toggleAll = (): void => {
    const next = !allCollapsed;
    setCollapsed((prev) => {
      const out = { ...prev };
      for (const g of filteredGroups) out[g.code] = next;
      return out;
    });
  };

  const onCopyCode = async (code: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      window.setTimeout(() => {
        setCopiedCode((current) => (current === code ? null : current));
      }, 1500);
    } catch {
      // Clipboard API can fail under insecure contexts; surface a subtle error.
      setError('Failed to copy to clipboard.');
    }
  };

  return (
    <>
      <PageHeader
        title={t('page.title')}
        description={t('page.description')}
      />
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {conflict && (
        <div className="mb-4">
          <ConflictBanner
            message={conflict}
            onRefresh={() => {
              void reloadSelected();
            }}
          />
        </div>
      )}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search.placeholder')}
            className="pl-8"
          />
        </div>
        {filteredGroups.length > 0 && (
          <Button variant="outline" size="sm" onClick={toggleAll}>
            {allCollapsed ? t('groups.expandAll') : t('groups.collapseAll')}
          </Button>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {loading && (
            <p className="text-sm text-muted-foreground">Loading settings…</p>
          )}
          {!loading && filteredGroups.length === 0 && search && (
            <p className="text-sm text-muted-foreground">{t('search.noResults')}</p>
          )}
          {!loading &&
            filteredGroups.map((group) => {
              const isCollapsed = !!collapsed[group.code];
              return (
                <Card key={group.code}>
                  <CardHeader>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.code)}
                      className="flex w-full items-center gap-2 text-left"
                      aria-expanded={!isCollapsed}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                      <CardTitle className="flex items-center gap-2">
                        {group.name}
                        {group.isSystemProtected && (
                          <span className="rounded bg-muted px-2 py-0.5 text-xs">
                            system
                          </span>
                        )}
                        <span className="text-xs font-normal text-muted-foreground">
                          ({group.settings.length})
                        </span>
                      </CardTitle>
                    </button>
                  </CardHeader>
                  {!isCollapsed && (
                    <CardContent>
                      {group.settings.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          {t('groups.empty')}
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t('table.column.name')}</TableHead>
                              <TableHead>{t('table.column.description')}</TableHead>
                              <TableHead className="w-24" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {group.settings.map((s) => {
                              const isCopied = copiedCode === s.code;
                              return (
                                <TableRow key={s.code}>
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      <span>{s.name}</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void onCopyCode(s.code);
                                        }}
                                        title={
                                          isCopied
                                            ? t('actions.copyCode.copied')
                                            : `${t('actions.copyCode.label')}: ${s.code}`
                                        }
                                        aria-label={`${t('actions.copyCode.label')}: ${s.code}`}
                                        className={cn(
                                          'rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                                          isCopied && 'text-emerald-600 hover:text-emerald-600',
                                        )}
                                      >
                                        {isCopied ? (
                                          <Check className="h-3.5 w-3.5" />
                                        ) : (
                                          <Copy className="h-3.5 w-3.5" />
                                        )}
                                      </button>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground">
                                    {s.description ?? ''}
                                  </TableCell>
                                  <TableCell>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setSelectedSetting(s)}
                                    >
                                      {t('actions.edit')}
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })}
        </div>
        <div>
          {selectedSetting ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{selectedSetting.name}</CardTitle>
                <p className="font-mono text-xs text-muted-foreground">
                  {selectedSetting.code}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <SettingValueEditor
                  setting={selectedSetting}
                  availableChannelCodes={allChannelCodes}
                  onSubmit={onSubmit}
                  saving={saving}
                />
                <div className="border-t pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void onReset()}
                    disabled={saving || selectedSetting.valuesByChannel.length === 0}
                  >
                    {t('actions.resetToDefault')}
                  </Button>
                </div>
                <div className="border-t pt-4 text-xs text-muted-foreground">
                  <div>{t('editor.default')}: {JSON.stringify(selectedSetting.defaultValue)}</div>
                  <div>{t('editor.module')}: {selectedSetting.ownerModule}</div>
                  <div>
                    {t('editor.perChannelValues')}: {selectedSetting.valuesByChannel.length}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                {t('editor.empty')}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function mergeChannelCodes(
  groups: SettingGroupDto[],
  allChannels: SalesChannelSummary[],
): string[] {
  const codes = new Set<string>();
  for (const c of allChannels) codes.add(c.code);
  for (const g of groups) {
    for (const s of g.settings) {
      for (const v of s.valuesByChannel) codes.add(v.salesChannelCode);
      for (const c of s.salesChannelCodes) codes.add(c);
    }
    for (const c of g.salesChannelCodes) codes.add(c);
  }
  return Array.from(codes).sort();
}

function filterGroupsBySearch(
  groups: SettingGroupDto[],
  search: string,
): SettingGroupDto[] {
  const q = search.trim().toLowerCase();
  if (!q) return groups;
  const out: SettingGroupDto[] = [];
  for (const g of groups) {
    const matches = g.settings.filter((s) => settingMatches(s, q));
    if (matches.length > 0) out.push({ ...g, settings: matches });
  }
  return out;
}

function settingMatches(s: SettingDto, q: string): boolean {
  if (s.name.toLowerCase().includes(q)) return true;
  if (s.code.toLowerCase().includes(q)) return true;
  if (s.description && s.description.toLowerCase().includes(q)) return true;
  return false;
}

function computeVersion(setting: SettingDto): string {
  let max = 0;
  for (const v of setting.valuesByChannel) {
    const t = new Date(v.updatedAt).getTime();
    if (t > max) max = t;
  }
  // Without an explicit setting.updatedAt in the DTO, the value max is the
  // best signal available; the server still returns 409 if any other write
  // bumps the effective version after this client loaded.
  return new Date(max).toISOString();
}
