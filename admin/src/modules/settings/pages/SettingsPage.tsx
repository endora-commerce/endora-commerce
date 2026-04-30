import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { SetValueRequest, SettingDto, SettingGroupDto } from '@b2b/contracts';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { settingsClient } from '../api/settings-client';
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
  const [groups, setGroups] = useState<SettingGroupDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSetting, setSelectedSetting] = useState<SettingDto | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await settingsClient.list();
      setGroups(res.groups);
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

  const allChannelCodes = uniqueChannelCodes(groups);

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

  return (
    <>
      <PageHeader
        title="Settings"
        description="Per-sales-channel configuration grouped by section. Each setting is declared by a backend module; values can be applied to all channels or to a chosen subset."
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
      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {loading && (
            <p className="text-sm text-muted-foreground">Loading settings…</p>
          )}
          {!loading &&
            groups.map((group) => (
              <Card key={group.code}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {group.name}
                    {group.isSystemProtected && (
                      <span className="rounded bg-muted px-2 py-0.5 text-xs">
                        system
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {group.settings.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No settings registered in this group.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Code</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="w-24" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.settings.map((s) => (
                          <TableRow key={s.code}>
                            <TableCell className="font-mono text-xs">{s.code}</TableCell>
                            <TableCell>{s.name}</TableCell>
                            <TableCell className="text-xs">{s.valueType}</TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedSetting(s)}
                              >
                                Edit
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            ))}
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
                    Reset to default for all channels
                  </Button>
                </div>
                <div className="border-t pt-4 text-xs text-muted-foreground">
                  <div>Default: {JSON.stringify(selectedSetting.defaultValue)}</div>
                  <div>Module: {selectedSetting.ownerModule}</div>
                  <div>
                    Per-channel values: {selectedSetting.valuesByChannel.length}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                Select a setting from the left to edit its value.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function uniqueChannelCodes(groups: SettingGroupDto[]): string[] {
  const codes = new Set<string>();
  for (const g of groups) {
    for (const s of g.settings) {
      for (const v of s.valuesByChannel) codes.add(v.salesChannelCode);
      for (const c of s.salesChannelCodes) codes.add(c);
    }
    for (const c of g.salesChannelCodes) codes.add(c);
  }
  return Array.from(codes).sort();
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
