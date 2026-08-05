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

/**
 * Tone modifiers on the shared `.b2b-badge`. The four neutral outcomes take
 * the base class alone — a queued or skipped run is not news, and giving it a
 * colour would spend the operator's attention on nothing.
 *
 * Deliberately design tokens rather than Tailwind's palette: `--success`
 * (#008060) and `--warn` (#b54708) are a different hue family from
 * `emerald-600` / `amber-600`, so the stock palette read as a foreign product
 * next to every other admin surface.
 */
const TONES: Record<FeedRunStatus, string> = {
  queued: '',
  running: '',
  completed: 'b2b-badge--success',
  completed_with_warnings: 'b2b-badge--warn',
  empty: '',
  failed: 'b2b-badge--danger',
  skipped: '',
};

export function FeedStatusBadge({ status }: { status: FeedRunStatus }): ReactNode {
  const t = useTranslation('product_feeds');
  const Icon = ICONS[status];
  return (
    <span className={`b2b-badge ${TONES[status]}`.trim()}>
      <Icon size={12} aria-hidden="true" className={status === 'running' ? 'animate-spin' : ''} />
      <span>{t(LABEL_KEYS[status])}</span>
    </span>
  );
}
