import type { ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Loader2,
  SkipForward,
  XCircle,
} from 'lucide-react';
import type { FeedRunStatus } from '@b2b/contracts';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Run outcome as **icon + word**, never colour alone (ux-design §2.1).
 *
 * The colour is a reinforcement; the icon and the label carry the meaning, so
 * the status is legible to a colour-blind operator and in a greyscale
 * screenshot pasted into a support ticket.
 */

const ICONS: Record<FeedRunStatus, typeof CheckCircle2> = {
  queued: Clock,
  running: Loader2,
  completed: CheckCircle2,
  completed_with_warnings: AlertTriangle,
  empty: CircleDashed,
  failed: XCircle,
  skipped: SkipForward,
};

const LABEL_KEYS: Record<FeedRunStatus, string> = {
  queued: 'runs.outcome.queued',
  running: 'runs.outcome.running',
  completed: 'runs.outcome.completed',
  completed_with_warnings: 'runs.outcome.completedWithWarnings',
  empty: 'runs.outcome.empty',
  failed: 'runs.outcome.failed',
  skipped: 'runs.outcome.skipped',
};

const TONES: Record<FeedRunStatus, string> = {
  queued: 'text-muted-foreground',
  running: 'text-muted-foreground',
  completed: 'text-emerald-600',
  completed_with_warnings: 'text-amber-600',
  empty: 'text-muted-foreground',
  failed: 'text-destructive',
  skipped: 'text-muted-foreground',
};

export function FeedStatusBadge({ status }: { status: FeedRunStatus }): ReactNode {
  const t = useTranslation('product_feeds');
  const Icon = ICONS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${TONES[status]}`}>
      <Icon size={14} aria-hidden="true" className={status === 'running' ? 'animate-spin' : ''} />
      <span>{t(LABEL_KEYS[status])}</span>
    </span>
  );
}
