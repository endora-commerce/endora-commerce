/**
 * `related_payers`' test support (`@endora-commerce/test-kit/support`): the tables of
 * this module whose rows must not survive from one test file into the next. Neither has
 * a foreign key to anything the harness truncates, so a link one file created would
 * otherwise stand for every later file on the same worker database — and a live link of
 * a pair makes the next file's create of that pair a `RELATED_PAYER_LINK_EXISTS`.
 */
export const volatileTables: readonly string[] = ['related_payer_links', 'related_payer_requests'];
