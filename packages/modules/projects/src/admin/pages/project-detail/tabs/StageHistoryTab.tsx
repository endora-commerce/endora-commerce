import { useEffect, useState, type ReactNode } from 'react';
import type { ProjectStageEntry } from '@endora-commerce/contracts';
import { formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription } from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../../../api.js';
import { errorMessage } from '../../../lib/labels.js';
import type { ProjectTabProps } from '../tabs.js';

/**
 * A Project's *Stage history* (`contracts/admin-api.md` §2.2,
 * `GET /projects/:id/stage-history`): every entry into a Stage, every close and
 * every reopen, with the Stage names as they were then, who did it and when —
 * newest first. Read again whenever the Project's version changes, so a move
 * made on this screen is in the list without a reload.
 */
export function StageHistoryTab({ project }: ProjectTabProps): ReactNode {
  const { language } = useTranslationContext();
  const t = useTranslation('projects');
  const [entries, setEntries] = useState<ProjectStageEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    projectsApi
      .stageHistory(project.id)
      .then((loaded) => {
        if (alive) setEntries([...loaded].reverse());
      })
      .catch((failure: unknown) => {
        if (alive) setError(errorMessage(failure, t('history.error')));
      });
    return (): void => {
      alive = false;
    };
  }, [project.id, project.version, t]);

  const describe = (entry: ProjectStageEntry): string => {
    switch (entry.kind) {
      case 'enter':
        return entry.fromStageName
          ? t('history.kind.move', { from: entry.fromStageName, to: entry.toStageName ?? '' })
          : t('history.kind.enter', { to: entry.toStageName ?? '' });
      case 'close_completed':
        return t('history.kind.close_completed', { stage: entry.fromStageName ?? '' });
      case 'close_lost':
        return t('history.kind.close_lost', { stage: entry.fromStageName ?? '' });
      case 'reopen':
        return t('history.kind.reopen', { stage: entry.toStageName ?? '' });
    }
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (entries === null) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('history.loading')}
      </p>
    );
  }
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">{t('history.empty')}</p>;

  return (
    <ol className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="space-y-0.5 border-l-2 pl-3">
          <p className="text-sm font-medium [overflow-wrap:anywhere]">{describe(entry)}</p>
          <p className="text-xs text-muted-foreground">
            {entry.actor?.name ?? t('history.system')} · <time dateTime={entry.at}>{formatDateTime(entry.at, language)}</time>
          </p>
          {entry.notes.map((note) => (
            <p key={note} className="text-xs text-muted-foreground">
              {t(`history.note.${note}`)}
            </p>
          ))}
        </li>
      ))}
    </ol>
  );
}

export default StageHistoryTab;
