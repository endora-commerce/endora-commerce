/**
 * The Task configuration screens (`contracts/admin-surfaces.md` §1) — one
 * place with four views since issue #1557 (UX audit WORK-06): the sidebar's
 * *Task configuration* row opens {@link TASK_CONFIGURATION_PATH}, the first
 * tab, the workflow; `TaskConfigurationTabs` switches between the four.
 *
 * The other three sit under that one address so the sidebar row lights up and
 * the breadcrumb names it on each of them: both match a row by prefix. The
 * first tab is the row's own address, as `/settings` and `/invoices` are, so
 * the row and the palette's *Task workflow* open the same route.
 */
export const TASK_CONFIGURATION_PATH = '/tasks/settings';
export const TASK_WORKFLOW_PATH = TASK_CONFIGURATION_PATH;
/** The workflow's address before issue #1557, a redirect now (bookmarks, the board's old links). */
export const LEGACY_TASK_WORKFLOW_PATH = `${TASK_CONFIGURATION_PATH}/workflow`;
export const TASK_PRIORITIES_PATH = `${TASK_CONFIGURATION_PATH}/priorities`;
export const TASK_TAGS_PATH = `${TASK_CONFIGURATION_PATH}/tags`;
export const TASK_GENERAL_SETTINGS_PATH = `${TASK_CONFIGURATION_PATH}/general`;
/** The workflow screen's *Board card* section, which the board's *Configure card* opens at. */
export const BOARD_CARD_ANCHOR = 'board-card';
