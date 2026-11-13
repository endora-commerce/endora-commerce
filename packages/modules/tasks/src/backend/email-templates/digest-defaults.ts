import { simpleEmailBodyTree } from '@endora-commerce/email-components/defaults/simple-email-body';
import type { PuckDataTree } from '@endora-commerce/email-components/schema/envelope';

/**
 * The default subject and body of the daily Task digest
 * (`specs/165-task-management/` research R-18), in the two languages an Admin
 * UI is drawn in.
 *
 * **The list is a repeated block.** The directive engine of
 * `@endora-commerce/email-components` supports `{{for alias in path}} …
 * {{/for}}` (`directives/directive-engine.ts`), and the body uses it over
 * `digest.tasks` — each `{number, title, due, overdue, today, adminUrl?}` — one
 * line per Task, so the HTML part breaks the lines as the text part does, and
 * the words around them ("overdue since", "due today") are the template's, per
 * language. `digest.taskList`, the number, title and due date of each joined
 * by line, is sent too: it is the variable the manifest declares, so an
 * operator editing the template sees a sample and may use it in a plain block.
 *
 * **Links, only when there is an address** (issue #185). On the platform's
 * `ADMIN_BASE_URL` each line's number and title link to the Task
 * (`task.adminUrl`) and a button opens *My tasks* (`digest.adminUrl`); the
 * list is a rich-text block so a line can hold its anchor. Where the admin's
 * address is not configured neither variable is sent: the lines are plain
 * text and the button is dropped.
 *
 * Never sent on a day with nothing due (FR-036).
 */

export const TASK_DIGEST_EMAIL_CODE = 'tasks_daily_digest';

const LINE = (overdue: string, today: string): string =>
  '{{for task in digest.tasks}}' +
  '{{if task.adminUrl}}<a href="{{var task.adminUrl}}">{{/if}}{{var task.number}} {{var task.title}}{{if task.adminUrl}}</a>{{/if}}' +
  ` — {{if task.overdue}}${overdue} {{var task.due}}{{/if}}{{if task.today}}${today}{{/if}}<br />` +
  '{{/for}}';

/** The simple layout, with the rich-text list between its first text and its closing line. */
function digestTree(opts: {
  heading: string;
  count: string;
  list: string;
  closing: string;
  ctaLabel: string;
}): PuckDataTree {
  const tree = simpleEmailBodyTree({
    idPrefix: 'tasks-daily-digest',
    heading: opts.heading,
    text: opts.count,
    ctaLabel: opts.ctaLabel,
    ctaHref: '{{var digest.adminUrl}}',
  });
  const content = [...(tree.content ?? [])] as { type: string; props: Record<string, unknown> }[];
  const at = content.findIndex((block) => block.type === 'transactional_emails.EmailText') + 1;
  content.splice(
    at,
    0,
    { type: 'transactional_emails.EmailRichText', props: { id: 'tasks-daily-digest-list', html: opts.list, align: 'left' } },
    { type: 'transactional_emails.EmailText', props: { id: 'tasks-daily-digest-closing', text: opts.closing, align: 'left' } },
  );
  return { ...tree, content };
}

export const TASK_DIGEST_DEFAULT = {
  defaultSubject: {
    'en-US': 'Your tasks for {{var digest.date}}: {{var digest.taskCount}} due or overdue',
    'pl-PL': 'Twoje zadania na {{var digest.date}}: {{var digest.taskCount}} na dziś lub po terminie',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': digestTree({
        heading: 'Your tasks for today',
        count: 'Due today or overdue: {{var digest.taskCount}}',
        list: LINE('overdue since', 'due today'),
        closing: 'Open My tasks in the admin panel to see them.',
        ctaLabel: 'Open My tasks',
      }),
      'pl-PL': digestTree({
        heading: 'Twoje zadania na dziś',
        count: 'Na dziś lub po terminie: {{var digest.taskCount}}',
        list: LINE('po terminie od', 'na dziś'),
        closing: 'Otwórz Moje zadania w panelu administracyjnym, aby je zobaczyć.',
        ctaLabel: 'Otwórz Moje zadania',
      }),
    },
  },
};
