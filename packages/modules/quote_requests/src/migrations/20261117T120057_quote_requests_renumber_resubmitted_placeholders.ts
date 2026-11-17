import { Migration } from '@mikro-orm/migrations';

/**
 * Gives every quote request still named by the entity's `QR-<uuid>`
 * placeholder a real business number.
 *
 * Until the fix beside this migration, `RfqService.resubmit` created the new
 * request without drawing from the business-id generator, so a re-submitted
 * request kept the placeholder `QR-` + a random UUID, which then named it in
 * the admin notification bell, the lists, its PDF and its e-mails. Requests
 * created any other way were numbered.
 *
 * Each such request draws `nextval('quote_requests_business_id_seq')`, oldest
 * first, wrapped in the configured prefix and suffix, exactly as the generator
 * builds a number: `${prefix}${sequence}${suffix}`. The generator reads the two
 * `quote_requests.business_id.*` settings for the system-default sales channel
 * and falls back to the setting's default, then to `''`; this reads them the
 * same way. Only the placeholder shape is matched, so a number an operator or
 * the generator wrote is never touched, and a second run changes nothing.
 *
 * Irreversible by design: the placeholders carried no meaning and are not kept,
 * so `down()` does nothing. Texts already rendered from a placeholder — sent
 * e-mails, downloaded PDFs, stored notification titles — keep it.
 */
export class Migration20261117T120057QuoteRequestsRenumberResubmittedPlaceholders extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      with affix as (
        select
          coalesce((
            select coalesce(
              (select v.value #>> '{}'
                 from "setting_values" v
                 join "sales_channels" c on c.id = v.sales_channel_id and c.system_default
                where v.setting_id = s.id
                limit 1),
              s.default_value #>> '{}')
              from "settings" s where s.code = 'quote_requests.business_id.prefix'), '') as prefix,
          coalesce((
            select coalesce(
              (select v.value #>> '{}'
                 from "setting_values" v
                 join "sales_channels" c on c.id = v.sales_channel_id and c.system_default
                where v.setting_id = s.id
                limit 1),
              s.default_value #>> '{}')
              from "settings" s where s.code = 'quote_requests.business_id.suffix'), '') as suffix
      ),
      placeholders as (
        select id
          from "quote_requests"
         where business_id ~ '^QR-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         order by created_at, id
      ),
      numbered as (
        select p.id, nextval('quote_requests_business_id_seq') as n
          from placeholders p
      )
      update "quote_requests" q
         set business_id = a.prefix || numbered.n::text || a.suffix
        from numbered, affix a
       where q.id = numbered.id;
    `);
  }

  override async down(): Promise<void> {
    // Irreversible: the placeholder numbers carried no meaning and are not kept.
  }
}
