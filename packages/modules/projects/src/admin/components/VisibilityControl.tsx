import { useEffect, useId, useState, type ReactNode } from 'react';
import type { ProjectVisibility, ProjectVisibilitySetting } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../api.js';
import { AdminUsersLookup, type LookupChoice } from './LookupPickers.js';

/**
 * Who sees a Project — the control on *New project* and on a Project's
 * *Overview* (`specs/163-projects-and-tasks/`, User Story 5; spec FR-018 –
 * FR-019, owner ruling Q2 = A; research R-3).
 *
 * Three choices, as radio buttons: *Follow the module setting*, *Everyone who
 * may view projects*, *Members and listed people*. The people listed are chosen
 * only with the last — a person listed under another choice would see the
 * Project without the screen saying so, so {@link visibilityBody} sends nobody
 * listed for the other two. Under the choices one sentence says what the choice
 * means **now**: for *Follow the module setting* that needs the setting itself,
 * read once from `GET /projects/visibility-setting`.
 *
 * What no choice changes is not repeated here: an administrator still sees a
 * Project only when they reach every one of its Organizations, and holders of
 * *See every project* see it whatever is chosen (the docs' *Who sees a
 * Project*).
 */

export interface VisibilityValue {
  visibility: ProjectVisibility;
  /** The people listed on the Project, by name. */
  viewers: LookupChoice[];
}

/** What a form sends: the choice, and the people listed only where the choice lists people. */
export function visibilityBody(value: VisibilityValue): { visibility: ProjectVisibility; viewerIds: string[] } {
  return {
    visibility: value.visibility,
    viewerIds: value.visibility === 'members_and_listed' ? value.viewers.map((viewer) => viewer.id) : [],
  };
}

const CHOICES: readonly ProjectVisibility[] = ['inherit', 'everyone', 'members_and_listed'];

/** The module setting, or `null` while unknown — still loading, or unreadable. */
function useVisibilitySetting(): ProjectVisibilitySetting | null | 'failed' {
  const [setting, setSetting] = useState<ProjectVisibilitySetting | null | 'failed'>(null);
  useEffect(() => {
    let alive = true;
    projectsApi
      .visibilitySetting()
      .then((value) => {
        if (alive) setSetting(value);
      })
      .catch(() => {
        if (alive) setSetting('failed');
      });
    return (): void => {
      alive = false;
    };
  }, []);
  return setting;
}

/**
 * The one sentence saying what `visibility` means under the module setting —
 * which it names by the label the Settings screen shows for it, so the option
 * and its explanation never call the same thing two names (issue #1565).
 */
export function VisibilityEffect(props: { visibility: ProjectVisibility; id?: string }): ReactNode {
  const t = useTranslation('projects');
  const setting = useVisibilitySetting();
  let key: string;
  if (props.visibility === 'everyone') key = 'visibility.effect.everyone';
  else if (props.visibility === 'members_and_listed') key = 'visibility.effect.membersAndListed';
  else if (setting === null) key = '';
  else if (setting === 'failed') key = 'visibility.effect.inheritUnknown';
  else key = setting === 'everyone' ? 'visibility.effect.inheritEveryone' : 'visibility.effect.inheritMembers';
  const settingLabel =
    setting === 'everyone' || setting === 'members' ? t(`settingLabels.projects.visibility.options.${setting}`) : '';
  return (
    <p id={props.id} aria-live="polite" className="text-sm text-muted-foreground">
      {key ? t(key, { setting: settingLabel }) : t('visibility.effect.loading')}
    </p>
  );
}

export interface VisibilityControlProps {
  value: VisibilityValue;
  onChange: (value: VisibilityValue) => void;
  disabled?: boolean;
}

export function VisibilityControl(props: VisibilityControlProps): ReactNode {
  const t = useTranslation('projects');
  const base = useId();
  const legendId = `${base}-legend`;
  const effectId = `${base}-effect`;
  const listedId = `${base}-listed`;
  const { value } = props;

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-labelledby={legendId} aria-describedby={effectId} className="space-y-1">
        <h3 id={legendId} className="text-base font-semibold">
          {t('visibility.section')}
        </h3>
        {CHOICES.map((choice) => {
          const id = `${base}-${choice}`;
          return (
            <label key={choice} htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
              <input
                id={id}
                type="radio"
                name={`${base}-visibility`}
                value={choice}
                checked={value.visibility === choice}
                disabled={props.disabled ?? false}
                className="h-4 w-4 accent-primary"
                onChange={(): void => props.onChange({ ...value, visibility: choice })}
              />
              {t(`visibility.option.${choice}`)}
            </label>
          );
        })}
      </div>
      <VisibilityEffect visibility={value.visibility} id={effectId} />
      {value.visibility === 'members_and_listed' ? (
        <div className="space-y-1">
          <label htmlFor={listedId} className="text-sm font-medium">
            {t('visibility.listed.label')}
          </label>
          <AdminUsersLookup
            id={listedId}
            ariaLabel={t('visibility.listed.label')}
            value={value.viewers}
            onChange={(viewers): void => props.onChange({ ...value, viewers })}
            placeholder={t('visibility.listed.placeholder')}
            disabled={props.disabled ?? false}
            removeLabel={(name): string => t('visibility.listed.remove', { name })}
          />
          {value.viewers.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('visibility.listed.empty')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
