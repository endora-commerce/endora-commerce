/**
 * `cms`' test support (`@endora-commerce/test-kit/support`): the tables of this
 * module whose rows must not survive from one test file into the next.
 *
 * **Why the templates are here (issue #1087).** A template's sales-channel
 * bindings hang off `sales_channels`, which the harness truncates and reseeds
 * for every booting file, so they cascade away — but `cms_templates` itself
 * hangs off nothing the truncate reaches. A template one file created therefore
 * stood, bound to no channel, for every later file on the same worker
 * database, and `seeded-content-renders.test.ts`, which reads the table whole
 * because the harness seeds no template, failed on a
 * `cta-free-shipping-<stamp>` written by `quickstart-smoke.test.ts`. A test
 * that needs a template writes its own.
 *
 * `cms_template_sales_channels` is named beside it although it cascades today
 * from both `cms_templates` and `sales_channels`: a cascade is a property of
 * today's foreign keys, not a guarantee, and the reset should not depend on it.
 */
export const volatileTables: readonly string[] = ['cms_templates', 'cms_template_sales_channels'];
