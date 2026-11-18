import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProjectDetail, RecordHistoryEntry } from '@endora-commerce/contracts';
import {
  RecordHistory,
  recordHistoryChanges,
  useRecordHistory,
  type RecordHistoryChange,
} from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../api.js';
import { calendarDateLabel, NO_VALUE, valueLabel } from '../lib/labels.js';
import { customFieldValueLabel, useCanSeeCustomFields, useProjectFieldDefinitions } from './ProjectCustomFields.js';

/**
 * The fields of an audited Project state that have a label of their own
 * (`history.field.<field>`); any other field is named from its key.
 */
const LABELLED_FIELDS: ReadonlySet<string> = new Set([
  'number',
  'title',
  'state',
  'value',
  'valueAmount',
  'valueCurrency',
  'startOn',
  'visibility',
  'stages',
  'stageName',
  'outcome',
  'recordKind',
  'kind',
  'length',
  'fileName',
  'note',
  'comment',
  'deleted',
  'changedFields',
  'changedCustomFields',
  // Issue #460 — what names somebody or something, the nested changes, and a
  // Stage's own fields.
  'members',
  'viewerIds',
  'organizationId',
  'organizationIds',
  'stageId',
  'stageIds',
  'moves',
  'tasks',
  'notes',
  'lossReasonCode',
  'lossCommentLength',
  'name',
  'color',
  'position',
  'plannedDurationDays',
  'responsibleRoleIds',
  'alertOffsetsDays',
  'completionGate',
  'completionPermitted',
  'startedOn',
  'deadlineOn',
  'deadlineManual',
]);

/** Bookkeeping, and the recorded Stage name a Stage's id stands in for. */
const SILENT_FIELDS: ReadonlySet<string> = new Set(['version', 'descriptionLength', 'stageName']);

/**
 * The identifiers this screen names (issue #460). Any other key ending `Id` or
 * `Ids` names nothing a reader could use and is never a row.
 */
const NAMED_ID_FIELDS: ReadonlySet<string> = new Set([
  'viewerIds',
  'organizationId',
  'organizationIds',
  'stageId',
  'stageIds',
  'responsibleRoleIds',
]);

/** The nested changes, each drawn as lines of its own. */
const NESTED_FIELDS: ReadonlySet<string> = new Set(['members', 'moves', 'tasks']);

/**
 * A custom field's row: `customFieldValues` is one audited object, shown as a
 * row per field (User Story 9). The server leaves it out for a reader without
 * `custom_fields:read`.
 */
const CUSTOM_FIELD_PREFIX = 'customField:';

/**
 * The audit trail records *which* value-bearing fields a write changed —
 * `changedFields` (`value`) and `changedCustomFields` (keys) — and never their
 * values (T144 F4). The server serves the values in their place from the
 * Project's own store (T145), as `valueAmount` / `valueCurrency` and
 * `customFieldValues`; an entry it has no stored values for keeps the names,
 * each one row naming them.
 */
const CHANGED_FIELDS = 'changedFields';
const CHANGED_CUSTOM_FIELDS = 'changedCustomFields';

/** The codes of a Stage entry's notes this bundle words (`history.note.<code>`). */
const ENTRY_NOTES: ReadonlySet<string> = new Set([
  'gate_not_applied_tasks_off',
  'stage_tasks_skipped',
  'tasks_materialize_failed',
]);

type State = Record<string, unknown>;

function asState(value: unknown): State | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as State) : null;
}

function isSilent(field: string): boolean {
  if (field.startsWith(CUSTOM_FIELD_PREFIX) || NAMED_ID_FIELDS.has(field)) return false;
  return SILENT_FIELDS.has(field) || /Ids?$/.test(field);
}

/** An audited state with its custom-field bag spread into a field per key. */
function withCustomFieldsSpread(state: unknown): unknown {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return state;
  const { customFieldValues, ...rest } = state as Record<string, unknown>;
  if (customFieldValues === null || typeof customFieldValues !== 'object' || Array.isArray(customFieldValues)) return state;
  const spread: Record<string, unknown> = { ...rest };
  for (const [key, value] of Object.entries(customFieldValues)) spread[`${CUSTOM_FIELD_PREFIX}${key}`] = value;
  return spread;
}

/**
 * An audited state with `valueAmount` / `valueCurrency` as one `value` field —
 * the amount in its currency's conventions, as the Project screen shows it
 * (`valueLabel`), or `null` for no value. A change of either is a change of
 * the value, one row (T145).
 */
function withValueJoined(state: unknown): unknown {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return state;
  const record = state as Record<string, unknown>;
  if (!('valueAmount' in record) && !('valueCurrency' in record)) return state;
  const { valueAmount, valueCurrency, ...rest } = record;
  const value =
    typeof valueAmount === 'string' && typeof valueCurrency === 'string'
      ? valueLabel({ amount: valueAmount, currency: valueCurrency })
      : null;
  return { ...rest, value };
}

/** `stageName` → `stage name`. */
function humaniseKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The Stage an entry is about when it is about one Stage — an edit of it, its
 * tasks, closing in it — rather than a move between two: the entry names it
 * once, as its lead, instead of as a row.
 */
export function stageOfEntry(entry: { before: unknown; after: unknown }): string | null {
  const before = asState(entry.before)?.stageId;
  const after = asState(entry.after)?.stageId;
  if (typeof before === 'string' && typeof after === 'string' && before !== after) return null;
  if (typeof after === 'string') return after;
  return typeof before === 'string' ? before : null;
}

/**
 * The rows an entry shows: what it changed, without bookkeeping, identifiers
 * this screen cannot name, or shapes it does not draw. The nested changes
 * (`members`, `moves`, `tasks`) are rows drawn as lines.
 */
export function projectHistoryChanges(entry: { before: unknown; after: unknown }): RecordHistoryChange[] {
  const plain = (value: unknown): boolean =>
    value === null ||
    ['string', 'number', 'boolean'].includes(typeof value) ||
    (Array.isArray(value) && value.every((item) => ['string', 'number'].includes(typeof item)));
  const aboutOneStage = stageOfEntry(entry) !== null;
  return recordHistoryChanges({
    before: withValueJoined(withCustomFieldsSpread(entry.before)),
    after: withValueJoined(withCustomFieldsSpread(entry.after)),
  })
    .filter((change) => !isSilent(change.field))
    .filter((change) => !(aboutOneStage && change.field === 'stageId'))
    .filter(
      (change) =>
        NESTED_FIELDS.has(change.field) || (plain(change.after) && (!('before' in change) || plain(change.before))),
    );
}

/** A Member as an audited state records one: who, and their Roles' ids. */
interface AuditedMember {
  adminUserId: string;
  roleIds: string[];
}

function auditedMembers(raw: unknown): AuditedMember[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): AuditedMember[] => {
    const member = asState(item);
    if (typeof member?.adminUserId !== 'string') return [];
    const roleIds = Array.isArray(member.roleIds)
      ? member.roleIds.filter((id): id is string => typeof id === 'string')
      : [];
    return [{ adminUserId: member.adminUserId, roleIds }];
  });
}

interface AuditedMove {
  fromStageId: string;
  toStageId: string;
}

function auditedMoves(raw: unknown): AuditedMove[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): AuditedMove[] => {
    const move = asState(item);
    return typeof move?.fromStageId === 'string' && typeof move.toStageId === 'string'
      ? [{ fromStageId: move.fromStageId, toStageId: move.toStageId }]
      : [];
  });
}

/**
 * A Stage task definition as an audited state records one. A task is known by
 * its title, or by its place when the entry records none.
 */
interface AuditedTask {
  key: string;
  title: string | null;
  position: number;
  /** What it is besides its title and place: a change of any of it is a change of the task. */
  rest: string;
}

function auditedTasks(raw: unknown): AuditedTask[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index): AuditedTask[] => {
    const task = asState(item);
    if (!task) return [];
    const title = typeof task.title === 'string' && task.title !== '' ? task.title : null;
    const position = typeof task.position === 'number' ? task.position : index + 1;
    const rest = JSON.stringify([task.responsibleRoleId ?? null, task.dueOffsetDays ?? null, task.descriptionLength ?? null]);
    return [{ key: title ?? `#${position}`, title, position, rest }];
  });
}

const beforeOf = (change: RecordHistoryChange): unknown => ('before' in change ? change.before : null);

/**
 * A Project's change history (User Story 7, FR-028; `GET /projects/:id/history`)
 * on the kit's `RecordHistory`: every Command about the Project, newest first, a
 * page at a time, each entry by what happened and the fields it changed. Notes
 * and messages are recorded by length, never by their text.
 *
 * **Nothing is shown by its id or its code** (issue #460). An audit entry names
 * people, Organizations, Stages and Roles by id and never by name (D-288,
 * `specs/conventions/audit-state.md`), so the names are this screen's to find:
 * people from the Project's Members, listed people and managers and from the
 * entries' actors; Organizations and Stages from the Project; Roles and loss
 * reasons from their dictionaries. A Stage the Project no longer has keeps the
 * name an older entry recorded for it; anything else this screen cannot name
 * reads as a former one, never as the id. The nested changes — the Members and
 * their Roles, the workflow's moves, a Stage's tasks — are lines of what was
 * added, changed and removed; a comment's kind and a Stage entry's notes are
 * words in the reader's language.
 */
export function ProjectHistory(props: { project: ProjectDetail; reloadKey?: number }): ReactNode {
  const t = useTranslation('projects');
  const { language } = useAppLanguage();
  const { project } = props;
  const projectId = project.id;
  const loadPage = useCallback((cursor: string | null) => projectsApi.history(projectId, cursor), [projectId]);
  const history = useRecordHistory<RecordHistoryEntry>(loadPage, props.reloadKey);
  const { entries } = history;
  const { definitions } = useProjectFieldDefinitions(useCanSeeCustomFields());
  const definitionOf = (field: string) =>
    definitions.find((definition) => `${CUSTOM_FIELD_PREFIX}${definition.key}` === field);
  const words = { yes: t('history.value.yes'), no: t('history.value.no') };

  /** Whether any entry read so far carries one of `fields` — what decides if a dictionary is worth reading. */
  const carries = (...fields: string[]): boolean =>
    (entries ?? []).some((entry) =>
      fields.some((field) => field in (asState(entry.before) ?? {}) || field in (asState(entry.after) ?? {})),
    );

  // Role names, archived Roles included — an old entry may name one. Read once
  // an entry names a Role.
  const wantsRoles = carries('members', 'responsibleRoleIds');
  const [roleNames, setRoleNames] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    if (!wantsRoles) return undefined;
    let alive = true;
    projectsApi
      .listRoles()
      .then((roles) => {
        if (alive) setRoleNames(new Map(roles.map((role) => [role.id, role.label])));
      })
      .catch(() => {
        if (alive) setRoleNames(new Map());
      });
    return (): void => {
      alive = false;
    };
  }, [wantsRoles]);

  // Loss reasons by code, the way a close records one. Read once an entry names one.
  const wantsLossReasons = carries('lossReasonCode');
  const [lossReasons, setLossReasons] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    if (!wantsLossReasons) return undefined;
    let alive = true;
    projectsApi
      .listLossReasons()
      .then((reasons) => {
        if (alive) setLossReasons(new Map(reasons.map((reason) => [reason.code, reason.label])));
      })
      .catch(() => {
        if (alive) setLossReasons(new Map());
      });
    return (): void => {
      alive = false;
    };
  }, [wantsLossReasons]);

  /** Everybody this screen can name: whoever acted, then the Project's own people. */
  const people = useMemo(() => {
    const names = new Map<string, string>();
    for (const entry of entries ?? []) {
      if (entry.actor.id && entry.actor.name) names.set(entry.actor.id, entry.actor.name);
    }
    for (const person of [...project.projectManagers, ...project.viewers]) names.set(person.id, person.name);
    for (const member of project.members) names.set(member.adminUser.id, member.adminUser.name);
    return names;
  }, [entries, project.projectManagers, project.viewers, project.members]);

  /** Stage names: the Project's own, then — for a Stage it no longer has — the newest name an entry recorded. */
  const stageNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const entry of entries ?? []) {
      for (const state of [asState(entry.after), asState(entry.before)]) {
        const id = state?.stageId;
        const recorded = state?.stageName ?? state?.name;
        if (typeof id === 'string' && typeof recorded === 'string' && recorded !== '' && !names.has(id)) {
          names.set(id, recorded);
        }
      }
    }
    for (const stage of project.stages) names.set(stage.id, stage.name);
    return names;
  }, [entries, project.stages]);

  /** Role names: the dictionary's, else the ones the Project's Members hold. */
  const roleNamesOf = useMemo(() => {
    const names = new Map(roleNames);
    for (const member of project.members) {
      for (const role of member.roles) if (!names.has(role.id)) names.set(role.id, role.name);
    }
    return names;
  }, [roleNames, project.members]);

  const personName = (id: unknown): string =>
    typeof id === 'string' ? (people.get(id) ?? t('history.value.formerMember')) : NO_VALUE;
  const stageName = (id: unknown): string =>
    typeof id === 'string' ? (stageNames.get(id) ?? t('history.value.formerStage')) : NO_VALUE;
  const organizationName = (id: unknown): string => {
    if (typeof id !== 'string') return NO_VALUE;
    const organization = project.organizations.find((candidate) => candidate.id === id);
    return organization?.name ?? t('history.value.formerOrganization');
  };
  /** Role names in the reader's alphabetical order; a Role nobody can name any more is left out. */
  const rolesLabel = (ids: readonly unknown[]): string => {
    const names = ids
      .map((id) => (typeof id === 'string' ? roleNamesOf.get(id) : undefined))
      .filter((name): name is string => name !== undefined)
      .sort((a, b) => a.localeCompare(b, language));
    return names.length === 0 ? NO_VALUE : names.join(', ');
  };
  const listOf = (ids: unknown, name: (id: unknown) => string): string =>
    Array.isArray(ids) && ids.length > 0 ? ids.map(name).join(', ') : NO_VALUE;
  const noteLabel = (code: unknown): string =>
    typeof code === 'string' && ENTRY_NOTES.has(code) ? t(`history.note.${code}`) : humaniseKey(String(code));

  const fieldLabel = (field: string): string => {
    if (field.startsWith(CUSTOM_FIELD_PREFIX)) {
      const definition = definitionOf(field);
      return definition ? (definition.label[language] ?? definition.labelDefault) : field.slice(CUSTOM_FIELD_PREFIX.length);
    }
    return LABELLED_FIELDS.has(field) ? t(`history.field.${field}`) : humaniseKey(field);
  };

  const renderValue = (field: string, raw: unknown): ReactNode => {
    if (field.startsWith(CUSTOM_FIELD_PREFIX)) return customFieldValueLabel(definitionOf(field), raw, language, words);
    if (raw === null || raw === undefined || raw === '') return NO_VALUE;
    if (typeof raw === 'boolean') return t(raw ? 'history.value.yes' : 'history.value.no');
    switch (field) {
      case CHANGED_FIELDS:
        return Array.isArray(raw) ? raw.map((name) => fieldLabel(String(name))).join(', ') : String(raw);
      case CHANGED_CUSTOM_FIELDS:
        return Array.isArray(raw) ? raw.map((key) => fieldLabel(`${CUSTOM_FIELD_PREFIX}${String(key)}`)).join(', ') : String(raw);
      case 'viewerIds':
        return listOf(raw, personName);
      case 'organizationId':
        return organizationName(raw);
      case 'organizationIds':
        return listOf(raw, organizationName);
      case 'stageId':
        return stageName(raw);
      case 'stageIds':
        return listOf(raw, stageName);
      case 'responsibleRoleIds':
        return Array.isArray(raw) ? rolesLabel(raw) : NO_VALUE;
      case 'notes':
        return Array.isArray(raw) && raw.length > 0 ? raw.map(noteLabel).join(' ') : NO_VALUE;
      case 'note':
        return noteLabel(raw);
      case 'kind':
        return raw === 'message' || raw === 'note' ? t(`history.value.kind.${raw}`) : humaniseKey(String(raw));
      case 'lossReasonCode':
        return lossReasons.get(String(raw)) ?? humaniseKey(String(raw));
      case 'state':
        return t(`state.${String(raw)}`);
      case 'visibility':
        return t(`visibility.option.${String(raw)}`);
      case 'recordKind':
        return t(`links.group.${String(raw)}`);
      case 'startOn':
      case 'startedOn':
      case 'deadlineOn':
        return typeof raw === 'string' ? calendarDateLabel(raw, language) : String(raw);
      default:
        break;
    }
    if (Array.isArray(raw)) return raw.length === 0 ? NO_VALUE : raw.join(', ');
    return String(raw);
  };

  /** A nested change as lines: what it added, what it changed, what it removed. */
  const lines = (items: readonly string[]): ReactNode =>
    items.length === 0 ? (
      NO_VALUE
    ) : (
      <ul className="space-y-0.5">
        {items.map((item, index) => (
          <li key={`${index}:${item}`}>{item}</li>
        ))}
      </ul>
    );

  const memberLines = (change: RecordHistoryChange): string[] => {
    const before = new Map(auditedMembers(beforeOf(change)).map((member) => [member.adminUserId, member.roleIds]));
    const after = new Map(auditedMembers(change.after).map((member) => [member.adminUserId, member.roleIds]));
    const added: string[] = [];
    const changed: string[] = [];
    for (const [id, roleIds] of after) {
      const was = before.get(id);
      if (was === undefined) {
        added.push(t('history.members.added', { name: personName(id), roles: rolesLabel(roleIds) }));
      } else if ([...was].sort().join() !== [...roleIds].sort().join()) {
        changed.push(
          t('history.members.rolesChanged', { name: personName(id), before: rolesLabel(was), after: rolesLabel(roleIds) }),
        );
      }
    }
    const removed = [...before.keys()]
      .filter((id) => !after.has(id))
      .map((id) => t('history.members.removed', { name: personName(id) }));
    return [...added, ...changed, ...removed];
  };

  const moveLines = (change: RecordHistoryChange): string[] => {
    const key = (move: AuditedMove): string => `${move.fromStageId}>${move.toStageId}`;
    const before = auditedMoves(beforeOf(change));
    const after = auditedMoves(change.after);
    const had = new Set(before.map(key));
    const has = new Set(after.map(key));
    const sentence = (template: string, move: AuditedMove): string =>
      t(template, { from: stageName(move.fromStageId), to: stageName(move.toStageId) });
    return [
      ...after.filter((move) => !had.has(key(move))).map((move) => sentence('history.moves.added', move)),
      ...before.filter((move) => !has.has(key(move))).map((move) => sentence('history.moves.removed', move)),
    ];
  };

  const taskLines = (change: RecordHistoryChange): string[] => {
    const before = auditedTasks(beforeOf(change));
    const after = auditedTasks(change.after);
    const had = new Map(before.map((task) => [task.key, task]));
    const has = new Set(after.map((task) => task.key));
    const title = (task: AuditedTask): string => task.title ?? t('history.tasks.numbered', { position: task.position });
    const added: string[] = [];
    const changed: string[] = [];
    for (const task of after) {
      const was = had.get(task.key);
      if (!was) added.push(t('history.tasks.added', { title: title(task) }));
      else if (was.rest !== task.rest) changed.push(t('history.tasks.changed', { title: title(task) }));
    }
    const removed = before
      .filter((task) => !has.has(task.key))
      .map((task) => t('history.tasks.removed', { title: title(task) }));
    return [...added, ...changed, ...removed];
  };

  const renderChange = (change: RecordHistoryChange): ReactNode | undefined => {
    if (change.field === 'members') return lines(memberLines(change));
    if (change.field === 'moves') return lines(moveLines(change));
    if (change.field === 'tasks') return lines(taskLines(change));
    return undefined;
  };

  const renderLead = (entry: RecordHistoryEntry): ReactNode => {
    const stage = stageOfEntry(entry);
    return stage === null ? null : <p className="text-sm">{t('history.lead.stage', { stage: stageName(stage) })}</p>;
  };

  return (
    <RecordHistory
      history={history}
      copy={{
        empty: t('changeHistory.empty'),
        end: t('changeHistory.end'),
        truncated: t('changeHistory.truncated'),
      }}
      heading={(entry) => t(`auditLog.${entry.action}`)}
      changes={projectHistoryChanges}
      fieldLabel={fieldLabel}
      renderValue={renderValue}
      renderChange={renderChange}
      renderLead={renderLead}
    />
  );
}
