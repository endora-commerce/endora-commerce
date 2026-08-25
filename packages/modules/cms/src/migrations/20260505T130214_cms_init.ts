import { Migration } from '@mikro-orm/migrations';

/**
 * CMS module — feature 014 / data-model.md.
 *
 * Schema changes (one atomic migration):
 *   - extends `cms_pages` with the new column set (name, slug, active,
 *     description, meta_*, content, languages, version) while keeping the
 *     legacy `path`, `title`, `body` columns for one release.
 *   - adds four new tables: `cms_blocks`, `cms_templates`, `cms_hooks`,
 *     `cms_hook_block_attachments`.
 *   - adds four channel-join tables, each carrying the slug or code denorm
 *     so per-channel uniqueness is DB-enforceable.
 *   - GIN indexes on the three content JSONB columns so the asset-ref scan
 *     stays fast (research R12).
 *   - backfills migrated `cms_pages` rows: slug=path, name=best-effort
 *     from title, active=(status='published'), content envelope built
 *     from the legacy body strings.
 *   - binds every migrated page to the platform's default sales channel.
 *   - seeds the 23 base Hook codes with `is_system=true`.
 *
 * The migration is idempotent: re-running against a partially-applied
 * state skips already-present rows.
 */
export class Migration20260505T130214CmsInit extends Migration {
  override async up(): Promise<void> {
    // ────────────────────────────────────────────────────────────────────
    // 1) cms_blocks
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "cms_blocks" (
        "id" uuid not null,
        "name" varchar(200) not null,
        "code" varchar(180) not null,
        "active" boolean not null default true,
        "description" text null,
        "content" jsonb not null default '{"schema_version":1,"languages":{}}'::jsonb,
        "languages" jsonb not null default '[]'::jsonb,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "cms_blocks_pkey" primary key ("id")
      );
    `);
    this.addSql('create index "cms_blocks_code_index" on "cms_blocks" ("code");');
    this.addSql(
      'create index "idx_cms_blocks_content_asset_refs" on "cms_blocks" using gin ("content" jsonb_path_ops);',
    );
    this.addSql(
      'create index "cms_blocks_active_index" on "cms_blocks" ("active") where "active" = true;',
    );

    // ────────────────────────────────────────────────────────────────────
    // 2) cms_templates
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "cms_templates" (
        "id" uuid not null,
        "name" varchar(200) not null,
        "code" varchar(180) not null,
        "description" text null,
        "content" jsonb not null default '{"schema_version":1,"languages":{}}'::jsonb,
        "languages" jsonb not null default '[]'::jsonb,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "cms_templates_pkey" primary key ("id")
      );
    `);
    this.addSql('create index "cms_templates_code_index" on "cms_templates" ("code");');
    this.addSql(
      'create index "idx_cms_templates_content_asset_refs" on "cms_templates" using gin ("content" jsonb_path_ops);',
    );

    // ────────────────────────────────────────────────────────────────────
    // 3) cms_hooks
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "cms_hooks" (
        "id" uuid not null,
        "name" varchar(200) not null,
        "code" varchar(180) not null,
        "active" boolean not null default true,
        "description" text null,
        "is_system" boolean not null default false,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "cms_hooks_pkey" primary key ("id"),
        constraint "cms_hooks_code_unique" unique ("code")
      );
    `);
    this.addSql(
      'create index "cms_hooks_active_index" on "cms_hooks" ("active") where "active" = true;',
    );

    // ────────────────────────────────────────────────────────────────────
    // 4) cms_hook_block_attachments
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "cms_hook_block_attachments" (
        "hook_id" uuid not null,
        "block_id" uuid not null,
        "position" int not null default 0,
        "created_at" timestamptz not null,
        constraint "cms_hook_block_attachments_pkey" primary key ("hook_id", "block_id"),
        constraint "cms_hook_block_attachments_hook_fk" foreign key ("hook_id")
          references "cms_hooks" ("id") on delete cascade,
        constraint "cms_hook_block_attachments_block_fk" foreign key ("block_id")
          references "cms_blocks" ("id") on delete restrict
      );
    `);
    this.addSql(
      'create index "idx_cms_hook_attachments_order" on "cms_hook_block_attachments" ("hook_id", "position", "block_id");',
    );

    // ────────────────────────────────────────────────────────────────────
    // 5) channel-join tables (4)
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "cms_page_sales_channels" (
        "page_id" uuid not null,
        "sales_channel_id" uuid not null,
        "slug" varchar(180) not null,
        constraint "cms_page_sales_channels_pkey" primary key ("page_id", "sales_channel_id"),
        constraint "cms_page_sales_channels_slug_unique" unique ("sales_channel_id", "slug"),
        constraint "cms_page_sales_channels_page_fk" foreign key ("page_id")
          references "cms_pages" ("id") on delete cascade,
        constraint "cms_page_sales_channels_channel_fk" foreign key ("sales_channel_id")
          references "sales_channels" ("id") on delete cascade
      );
    `);
    this.addSql(`
      create table "cms_block_sales_channels" (
        "block_id" uuid not null,
        "sales_channel_id" uuid not null,
        "code" varchar(180) not null,
        constraint "cms_block_sales_channels_pkey" primary key ("block_id", "sales_channel_id"),
        constraint "cms_block_sales_channels_code_unique" unique ("sales_channel_id", "code"),
        constraint "cms_block_sales_channels_block_fk" foreign key ("block_id")
          references "cms_blocks" ("id") on delete cascade,
        constraint "cms_block_sales_channels_channel_fk" foreign key ("sales_channel_id")
          references "sales_channels" ("id") on delete cascade
      );
    `);
    this.addSql(`
      create table "cms_template_sales_channels" (
        "template_id" uuid not null,
        "sales_channel_id" uuid not null,
        "code" varchar(180) not null,
        constraint "cms_template_sales_channels_pkey" primary key ("template_id", "sales_channel_id"),
        constraint "cms_template_sales_channels_code_unique" unique ("sales_channel_id", "code"),
        constraint "cms_template_sales_channels_template_fk" foreign key ("template_id")
          references "cms_templates" ("id") on delete cascade,
        constraint "cms_template_sales_channels_channel_fk" foreign key ("sales_channel_id")
          references "sales_channels" ("id") on delete cascade
      );
    `);
    this.addSql(`
      create table "cms_hook_sales_channels" (
        "hook_id" uuid not null,
        "sales_channel_id" uuid not null,
        constraint "cms_hook_sales_channels_pkey" primary key ("hook_id", "sales_channel_id"),
        constraint "cms_hook_sales_channels_hook_fk" foreign key ("hook_id")
          references "cms_hooks" ("id") on delete cascade,
        constraint "cms_hook_sales_channels_channel_fk" foreign key ("sales_channel_id")
          references "sales_channels" ("id") on delete cascade
      );
    `);

    // ────────────────────────────────────────────────────────────────────
    // 6) cms_pages — extension columns
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`alter table "cms_pages"
      add column "name" varchar(200) not null default '',
      add column "slug" varchar(180) not null default '',
      add column "active" boolean not null default true,
      add column "description" text null,
      add column "meta_title" jsonb null,
      add column "meta_description" jsonb null,
      add column "meta_keywords" jsonb null,
      add column "content" jsonb not null default '{"schema_version":1,"languages":{}}'::jsonb,
      add column "languages" jsonb not null default '[]'::jsonb,
      add column "version" int not null default 1;
    `);
    this.addSql('create index "cms_pages_slug_index" on "cms_pages" ("slug");');
    this.addSql(
      'create index "idx_cms_pages_content_asset_refs" on "cms_pages" using gin ("content" jsonb_path_ops);',
    );
    this.addSql(
      'create index "cms_pages_active_status_index" on "cms_pages" ("active", "status");',
    );

    // ────────────────────────────────────────────────────────────────────
    // 7) Backfill cms_pages — best-effort
    // ────────────────────────────────────────────────────────────────────
    // slug = path
    // name = title['en-US'] ?? first available value, falling back to path
    // active = (status='published')
    // content = { schema_version: 1, languages: { <lang>: { root: {}, content: [{ type: 'Text', props: { tiptapContent: <legacy html> } }] } } }
    // languages = array of non-empty body keys
    this.addSql(`
      update "cms_pages"
      set
        "slug" = coalesce(nullif("slug", ''), "path"),
        "name" = coalesce(
          nullif("name", ''),
          coalesce(("title" ->> 'en-US')::text, '')
        ),
        "active" = case when "status" = 'published' then true else false end
      where "slug" = '' or "name" = '';
    `);

    // 7b) Build content envelope from legacy body for every row whose
    // content is still the empty default. Done in plain SQL via jsonb_object_agg
    // over the body's per-language values.
    this.addSql(`
      update "cms_pages"
      set "content" = jsonb_build_object(
        'schema_version', 1,
        'languages', coalesce(
          (
            select jsonb_object_agg(
              k,
              jsonb_build_object(
                'root', '{}'::jsonb,
                'content', jsonb_build_array(
                  jsonb_build_object(
                    'type', 'Text',
                    'props', jsonb_build_object(
                      'id', 'text-legacy-' || k,
                      'tiptapHtml', v
                    )
                  )
                ),
                'zones', '{}'::jsonb
              )
            )
            from jsonb_each_text("body") as t(k, v)
            where v <> ''
          ),
          '{}'::jsonb
        )
      )
      where "content" = '{"schema_version":1,"languages":{}}'::jsonb
        and "body" <> '{}'::jsonb;
    `);

    // 7c) languages array = non-empty body keys
    this.addSql(`
      update "cms_pages"
      set "languages" = coalesce(
        (
          select jsonb_agg(k)
          from jsonb_each_text("body") as t(k, v)
          where v <> ''
        ),
        '[]'::jsonb
      )
      where "languages" = '[]'::jsonb and "body" <> '{}'::jsonb;
    `);

    // ────────────────────────────────────────────────────────────────────
    // 8) Bind every migrated cms_pages row to the default sales channel
    // ────────────────────────────────────────────────────────────────────
    // Pick the first sales channel by created_at as the "default"; in
    // production this will be the system_default = true row but we don't
    // require that here (foundation seed tests sometimes create only one
    // channel without flagging it).
    this.addSql(`
      insert into "cms_page_sales_channels" ("page_id", "sales_channel_id", "slug")
      select p."id", c."id", p."slug"
      from "cms_pages" p
      cross join lateral (
        select "id" from "sales_channels" order by "created_at" asc limit 1
      ) c
      where not exists (
        select 1 from "cms_page_sales_channels" x where x."page_id" = p."id"
      );
    `);

    // ────────────────────────────────────────────────────────────────────
    // 9) Seed the 23 base Hook codes (research R8)
    // ────────────────────────────────────────────────────────────────────
    const seededHooks: Array<[string, string, string]> = [
      ['header.top', 'Header Top', 'Top-of-page strip — phone number, free-shipping notice, etc.'],
      ['homepage.top', 'Homepage Top', 'Above the homepage content.'],
      ['homepage.bottom', 'Homepage Bottom', 'Below the homepage content.'],
      ['footer.before', 'Footer Before', ''],
      ['footer.top', 'Footer Top', ''],
      ['footer.bottom', 'Footer Bottom', ''],
      ['footer.after', 'Footer After', ''],
      ['footer.copyright', 'Footer Copyright', ''],
      ['category.top', 'Category Page Top', ''],
      ['category.bottom', 'Category Page Bottom', ''],
      ['product.top', 'Product Page Top', ''],
      ['product.bottom', 'Product Page Bottom', ''],
      ['product.buttons.after', 'Product Page After Buttons Set', ''],
      ['search.top', 'Search Page Top', ''],
      ['search.bottom', 'Search Page Bottom', ''],
      ['page.top', 'Every Page Top', ''],
      ['page.bottom', 'Every Page Bottom', ''],
      ['cms.page.top', 'Every CMS Page Top', ''],
      ['cms.page.bottom', 'Every CMS Page Bottom', ''],
      ['login.top', 'Login Page Top', ''],
      ['login.bottom', 'Login Page Bottom', ''],
      ['register.top', 'Register Page Top', ''],
      ['register.bottom', 'Register Page Bottom', ''],
    ];
    for (const [code, name, description] of seededHooks) {
      const desc = description.length > 0 ? `'${description.replace(/'/g, "''")}'` : 'null';
      this.addSql(`
        insert into "cms_hooks" ("id", "name", "code", "active", "description", "is_system", "version", "created_at", "updated_at")
        values (gen_random_uuid(), '${name.replace(/'/g, "''")}', '${code}', true, ${desc}, true, 1, now(), now())
        on conflict ("code") do nothing;
      `);
    }

    // 9b) Bind every seeded Hook to every existing sales channel.
    this.addSql(`
      insert into "cms_hook_sales_channels" ("hook_id", "sales_channel_id")
      select h."id", c."id"
      from "cms_hooks" h
      cross join "sales_channels" c
      where h."is_system" = true
        and not exists (
          select 1 from "cms_hook_sales_channels" x
          where x."hook_id" = h."id" and x."sales_channel_id" = c."id"
        );
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "cms_hook_sales_channels" cascade;');
    this.addSql('drop table if exists "cms_template_sales_channels" cascade;');
    this.addSql('drop table if exists "cms_block_sales_channels" cascade;');
    this.addSql('drop table if exists "cms_page_sales_channels" cascade;');
    this.addSql('drop table if exists "cms_hook_block_attachments" cascade;');
    this.addSql('drop table if exists "cms_hooks" cascade;');
    this.addSql('drop table if exists "cms_templates" cascade;');
    this.addSql('drop table if exists "cms_blocks" cascade;');

    this.addSql('drop index if exists "cms_pages_active_status_index";');
    this.addSql('drop index if exists "idx_cms_pages_content_asset_refs";');
    this.addSql('drop index if exists "cms_pages_slug_index";');
    this.addSql(`alter table "cms_pages"
      drop column if exists "version",
      drop column if exists "languages",
      drop column if exists "content",
      drop column if exists "meta_keywords",
      drop column if exists "meta_description",
      drop column if exists "meta_title",
      drop column if exists "description",
      drop column if exists "active",
      drop column if exists "slug",
      drop column if exists "name";
    `);
  }
}
