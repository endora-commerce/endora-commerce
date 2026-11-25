import type { ReactNode } from 'react';
import type { RecordMergeState, RecordMergeStepState } from '@endora-commerce/contracts';
import { Badge } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

const MERGE_VARIANT: Record<RecordMergeState, 'secondary' | 'warning' | 'success' | 'outline'> = {
  running: 'secondary',
  needs_attention: 'warning',
  completed: 'success',
  cancelled: 'outline',
};

const STEP_VARIANT: Record<RecordMergeStepState, 'secondary' | 'warning' | 'success' | 'outline' | 'destructive'> = {
  pending: 'outline',
  running: 'secondary',
  done: 'success',
  failed: 'destructive',
  deferred: 'warning',
};

/** A merge's state as a labelled badge — the word carries it, never the colour alone. */
export function MergeStateBadge({ state }: { state: RecordMergeState }): ReactNode {
  const own = useTranslation('projects');
  return <Badge variant={MERGE_VARIANT[state]}>{own(`merge.state.${state}`)}</Badge>;
}

/** A step's state as a labelled badge. */
export function MergeStepStateBadge({ state }: { state: RecordMergeStepState }): ReactNode {
  const own = useTranslation('projects');
  return <Badge variant={STEP_VARIANT[state]}>{own(`merge.stepState.${state}`)}</Badge>;
}
