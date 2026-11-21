import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * UX audit 2026-11-17, WORK-11 (issue #1486), with the DS-02 text pass (#1436):
 * the CRM, Tasks and Projects screens lost the page descriptions and hints that
 * restated a title or described the controls below them, and the ones kept were
 * cut to the one-line budget of `specs/conventions/module-i18n.md`.
 *
 * Two things are pinned here, per bundle and per language: a cut key stays cut —
 * a key with no reader is copy a translator keeps paying for — and a kept
 * description or hint fits on its one clamped line again.
 */
const ONE_LINE = 80;

type WorkModule = 'crm' | 'tasks' | 'projects';

const CUT: Record<WorkModule, readonly string[]> = {
  crm: [
    'analytics.description',
    'assignment.changeHint',
    'board.description',
    'boardCard.description',
    'calendar.description',
    'opportunity.create.description',
    'opportunity.create.requiredHint',
    'opportunity.list.description',
    'opportunity.stage.hint',
    'opportunity.status.reasonHint',
    'tags.description',
    'value.hint.manual',
    'workflow.description',
    'workflow.statuses.description',
  ],
  tasks: [
    'boardCard.description',
    'comments.hint',
    'create.requiredHint',
    'field.assigneeHint',
    'list.description',
    'mine.description',
    'priorities.description',
    'priorities.list.description',
    'tags.description',
    'tags.list.description',
    'workflow.description',
    'workflow.field.categoryHint',
    'workflow.statuses.description',
  ],
  projects: [
    'create.requiredHint',
    'create.stages.hint',
    'editor.hint',
    'editor.movesHint',
    'list.description',
    'lossReasons.description',
    // The Stage's one Save writes its tasks too (issue #1523).
    'stageTasks.save',
    'stageTasks.saved',
    'tasks.hint',
    'templates.editor.intro',
    'templates.editor.rolesHint',
    'templates.editor.stagesHint',
  ],
};

const SHORTENED: Record<WorkModule, readonly string[]> = {
  crm: [
    'analytics.handling.description',
    'analytics.reps.description',
    'analytics.status.description',
    'analytics.value.description',
    'assignment.create.hint',
    'board.readOnly',
    'boardCard.shown.titleAlways',
    'events.closedNote',
    'events.field.remindHint',
    'links.add.hint',
    'links.empty',
    'links.quote.add.hint',
    'value.counting.description',
    'value.hint.computed',
    'workflow.field.codeHint',
    'workflow.mapping.description',
    'workflow.reverse.description',
  ],
  tasks: [
    'attachments.dropHint',
    'create.description',
    'create.draftHint',
    'detail.draftHint',
    'detail.privateHint',
    'detail.privateOnHint',
    'digest.hint',
    'field.descriptionHint',
    'priorities.empty.body',
    'priorities.field.codeHint',
    'settingLabels.tasks.board_card_fields.description',
    'settingLabels.tasks.time_zone.description',
    'settings.timeZoneHint',
    'tags.empty.body',
    'workflow.field.codeHint',
    'workflow.field.initialLockedHint',
    'workflow.transitions.description',
  ],
  projects: [
    'analytics.description',
    'analytics.lossStages.description',
    'analytics.managers.description',
    'analytics.stages.description',
    'analytics.summary.description',
    'analytics.top.description',
    'create.internalNote',
    'create.members.hint',
    'create.template.hint',
    'create.template.stagesHint',
    'editor.alertsHint',
    'editor.deadlineFieldHint',
    'editor.gateHint',
    'links.hint',
    'roles.description',
    'settingLabels.projects.enabled.description',
    'settingLabels.projects.visibility.description',
    'stageTasks.hint',
    'templates.list.description',
  ],
};

function bundle(module: WorkModule, language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/${module}/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

const MODULES: readonly WorkModule[] = ['crm', 'tasks', 'projects'];

describe.each(MODULES)('%s copy (UX audit WORK-11)', (module) => {
  it.each(['en', 'pl'] as const)('keeps every cut description and hint out of the %s bundle', (language) => {
    const messages = bundle(module, language);
    expect(CUT[module].filter((key) => key in messages)).toEqual([]);
  });

  it.each(['en', 'pl'] as const)('fits every shortened %s line in the one-line budget', (language) => {
    const messages = bundle(module, language);
    const over = SHORTENED[module]
      .map((key) => ({ key, length: messages[key]?.length ?? Number.NaN }))
      .filter(({ length }) => !(length <= ONE_LINE));
    expect(over).toEqual([]);
  });
});
