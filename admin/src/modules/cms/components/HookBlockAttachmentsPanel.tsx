import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { CmsBlockSummary, CmsHookDetail, CmsHookSummary } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cmsClient } from '../api/cms-client';

type HookAttachment = CmsHookDetail['attachments'][number];

interface HookBlockAttachmentsPanelProps {
  hook: CmsHookSummary | null;
  onChanged?: () => void;
}

function nextPosition(rows: HookAttachment[]): number {
  const max = rows.reduce((out, row) => Math.max(out, row.position), -10);
  return max + 10;
}

function move<T>(items: T[], from: number, to: number): T[] {
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  if (item === undefined) return items;
  copy.splice(to, 0, item);
  return copy;
}

export function HookBlockAttachmentsPanel({
  hook,
  onChanged,
}: HookBlockAttachmentsPanelProps): ReactNode {
  const [attachments, setAttachments] = useState<HookAttachment[]>([]);
  const [blocks, setBlocks] = useState<CmsBlockSummary[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState('');
  const [position, setPosition] = useState(0);
  const [dragBlockId, setDragBlockId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attachedIds = useMemo(
    () => new Set(attachments.map((row) => row.blockId)),
    [attachments],
  );
  const attachableBlocks = useMemo(
    () => blocks.filter((block) => !attachedIds.has(block.id)),
    [attachedIds, blocks],
  );

  const load = useCallback(async (): Promise<void> => {
    if (!hook) {
      setAttachments([]);
      setBlocks([]);
      setSelectedBlockId('');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [hookDetail, blockList] = await Promise.all([
        cmsClient.getHook(hook.id),
        cmsClient.listBlocks(),
      ]);
      setAttachments(hookDetail.attachments);
      setBlocks(blockList.data);
      setPosition(nextPosition(hookDetail.attachments));
      setSelectedBlockId((current) =>
        blockList.data.some((block) => block.id === current) ? current : '',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [hook]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedBlockId && attachableBlocks[0]) setSelectedBlockId(attachableBlocks[0].id);
  }, [attachableBlocks, selectedBlockId]);

  async function addAttachment(): Promise<void> {
    if (!hook || !selectedBlockId) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await cmsClient.addHookAttachment(hook.id, {
        blockId: selectedBlockId,
        position,
      });
      setAttachments(updated);
      setPosition(nextPosition(updated));
      setSelectedBlockId('');
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function persistOrder(next: HookAttachment[]): Promise<void> {
    if (!hook) return;
    setSaving(true);
    setError(null);
    const normalized = next.map((row, index) => ({ ...row, position: index * 10 }));
    setAttachments(normalized);
    try {
      await Promise.all(
        normalized.map((row) =>
          cmsClient.reorderHookAttachment(hook.id, row.blockId, row.position),
        ),
      );
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function removeAttachment(blockId: string): Promise<void> {
    if (!hook) return;
    setSaving(true);
    setError(null);
    try {
      await cmsClient.removeHookAttachment(hook.id, blockId);
      const updated = attachments.filter((row) => row.blockId !== blockId);
      setAttachments(updated);
      setPosition(nextPosition(updated));
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!hook) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attachments</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Select a Hook.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="min-w-0 text-base">
          <span className="truncate">{hook.name}</span>
        </CardTitle>
        <Button
          type="button"
          size="icon"
          variant="outline"
          title="Refresh attachments"
          onClick={() => void load()}
          disabled={loading || saving}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-[1fr_5rem_auto] gap-2">
          <Select
            value={selectedBlockId}
            onChange={(event) => setSelectedBlockId(event.target.value)}
            disabled={saving || attachableBlocks.length === 0}
          >
            {attachableBlocks.length === 0 ? <option value="">No available blocks</option> : null}
            {attachableBlocks.map((block) => (
              <option key={block.id} value={block.id}>
                {block.name} ({block.code})
              </option>
            ))}
          </Select>
          <Input
            type="number"
            min={0}
            value={position}
            onChange={(event) => setPosition(Number(event.target.value))}
            disabled={saving}
          />
          <Button
            type="button"
            title="Add block"
            onClick={() => void addAttachment()}
            disabled={saving || !selectedBlockId}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading attachments…</p>
        ) : attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No blocks attached.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Block</TableHead>
                <TableHead>Code</TableHead>
                <TableHead className="w-24 text-right">Position</TableHead>
                <TableHead className="w-32 text-right">Order</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attachments.map((attachment, index) => (
                <TableRow
                  key={attachment.blockId}
                  draggable
                  onDragStart={() => setDragBlockId(attachment.blockId)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    const from = attachments.findIndex((row) => row.blockId === dragBlockId);
                    if (from < 0 || from === index) return;
                    void persistOrder(move(attachments, from, index));
                  }}
                  onDragEnd={() => setDragBlockId(null)}
                >
                  <TableCell>
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">
                      {blocks.find((block) => block.id === attachment.blockId)?.name ??
                        attachment.blockId}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{attachment.blockCode}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline">{attachment.position}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        title="Move up"
                        disabled={saving || index === 0}
                        onClick={() => void persistOrder(move(attachments, index, index - 1))}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        title="Move down"
                        disabled={saving || index === attachments.length - 1}
                        onClick={() => void persistOrder(move(attachments, index, index + 1))}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        title="Remove"
                        disabled={saving}
                        onClick={() => void removeAttachment(attachment.blockId)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
