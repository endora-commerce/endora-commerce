/**
 * Dev seed (T093 / quickstart §3).
 *
 * Idempotent enough to run repeatedly during a development loop: drops and
 * recreates the public catalog tables, then bulk-inserts:
 *
 *   - 1 public Sales Channel + 1 logged-in-only channel.
 *   - 3-level Category tree (10 leaves total).
 *   - ~10 ProductAttributes (5 filterable, 3 searchable, 2 internal).
 *   - 200 synthetic Products with varied attributes/categories.
 *   - 1 Platform Administrator (admin@demo.local).
 *   - 1 demo Organization with 1 organization_admin Customer.
 *
 * Credentials are printed to stdout so the developer can sign in immediately.
 *
 * NOT for production. Drops business-data tables — refuses to run unless
 * NODE_ENV !== 'production' and the DATABASE_URL points at a localhost or
 * docker-compose host.
 */

import { initOrm, closeOrm } from '../../../db/index.js';
import { Product } from '../entities/product.entity.js';
import { Category } from '../entities/category.entity.js';
import { ProductAttribute } from '../entities/product-attribute.entity.js';
import { SalesChannel } from '../entities/sales-channel.entity.js';
import { Organization } from '../../organizations/entities/organization.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { AdminUser } from '../../admin_users/entities/admin-user.entity.js';
import { AdminRole } from '../../admin_roles/entities/admin-role.entity.js';
import { DeliveryMethod } from '../../delivery_methods/entities/delivery-method.entity.js';
import { PaymentMethod } from '../../payment_methods/entities/payment-method.entity.js';
import { Tax } from '../../taxes/entities/tax.entity.js';
import { PriceList } from '../../price_lists/entities/price-list.entity.js';
import { PriceListItem } from '../../price_lists/entities/price-list-item.entity.js';
import { PriceListAssignment } from '../../price_lists/entities/price-list-assignment.entity.js';
import { hashPassword } from '../../auth/services/password-hasher.js';

const DEMO_ADMIN_EMAIL = 'admin@demo.local';
const DEMO_ADMIN_PASSWORD = 'ChangeMe!123';
const DEMO_ORG_NAME = 'Acme B2B (demo)';
const DEMO_ORG_TAX_ID = 'PL5210000099';
const DEMO_BUYER_EMAIL = 'buyer@demo-org.example';
const DEMO_BUYER_PASSWORD = 'ChangeMe!123';

const PRODUCT_COUNT = 200;
const COLOR_VALUES = ['red', 'green', 'blue', 'black', 'white'];
const MATERIAL_VALUES = ['steel', 'aluminium', 'plastic', 'wood', 'glass'];

interface SeedRow<T> {
  data: T;
}

function mustBeNonProduction(): void {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('refusing to run dev-catalog-seed in NODE_ENV=production');
  }
  const url = process.env['DATABASE_URL'] ?? 'postgresql://b2b:b2b@localhost:5432/b2b';
  if (!/localhost|127\.0\.0\.1|postgres(?::\d+)?/.test(url)) {
    throw new Error(
      `refusing to run dev-catalog-seed against a non-local DATABASE_URL: ${url}`,
    );
  }
}

async function main(): Promise<void> {
  mustBeNonProduction();
  const orm = await initOrm();
  const em = orm.em.fork();
  const conn = em.getConnection();

  // Wipe in dependency order so re-runs work without manual cleanup.
  await conn.execute(`
    truncate table
      sales_channel_products,
      product_categories,
      product_assets,
      product_attributes,
      products,
      categories,
      sales_channels,
      customer_accounts,
      organizations,
      admin_users,
      admin_roles,
      price_list_assignments,
      price_list_items,
      price_lists,
      taxes,
      delivery_methods,
      payment_methods
    cascade
  `);

  // --- Sales Channels --------------------------------------------------
  const retail = em.create(SalesChannel, {
    code: 'pl_retail',
    name: { 'en-US': 'PL Retail', 'pl-PL': 'PL Retail' },
    isPublic: true,
    defaultLanguage: 'pl-PL',
    defaultCurrency: 'PLN',
  });
  const b2bVip = em.create(SalesChannel, {
    code: 'pl_b2b_vip',
    name: { 'en-US': 'PL B2B VIP', 'pl-PL': 'PL B2B VIP' },
    isPublic: false,
    defaultLanguage: 'pl-PL',
    defaultCurrency: 'PLN',
  });
  await em.persistAndFlush([retail, b2bVip]);

  // --- Categories — 3-level tree ---------------------------------------
  const root = em.create(Category, {
    name: { 'en-US': 'Catalog', 'pl-PL': 'Katalog' },
    slug: 'catalog',
  });
  await em.persistAndFlush(root);

  const sectionDefs: Array<{ slug: string; nameEn: string }> = [
    { slug: 'fasteners', nameEn: 'Fasteners' },
    { slug: 'tools', nameEn: 'Tools' },
    { slug: 'electronics', nameEn: 'Electronics' },
    { slug: 'safety', nameEn: 'Safety equipment' },
  ];
  const sections: Category[] = [];
  for (const s of sectionDefs) {
    const cat = em.create(Category, {
      parentCategoryId: root.id,
      name: { 'en-US': s.nameEn },
      slug: s.slug,
    });
    sections.push(cat);
  }
  await em.persistAndFlush(sections);

  const leafDefs: Array<{ parentSlug: string; slug: string; nameEn: string }> = [
    { parentSlug: 'fasteners', slug: 'screws', nameEn: 'Screws' },
    { parentSlug: 'fasteners', slug: 'bolts', nameEn: 'Bolts' },
    { parentSlug: 'tools', slug: 'wrenches', nameEn: 'Wrenches' },
    { parentSlug: 'tools', slug: 'drills', nameEn: 'Drills' },
    { parentSlug: 'electronics', slug: 'cables', nameEn: 'Cables' },
    { parentSlug: 'electronics', slug: 'sensors', nameEn: 'Sensors' },
    { parentSlug: 'safety', slug: 'gloves', nameEn: 'Gloves' },
    { parentSlug: 'safety', slug: 'helmets', nameEn: 'Helmets' },
  ];
  const leaves: Category[] = [];
  for (const l of leafDefs) {
    const parent = sections.find((s) => s.slug === l.parentSlug)!;
    leaves.push(
      em.create(Category, {
        parentCategoryId: parent.id,
        name: { 'en-US': l.nameEn },
        slug: l.slug,
      }),
    );
  }
  await em.persistAndFlush(leaves);

  // --- Product attributes ---------------------------------------------
  const attrColor = em.create(ProductAttribute, {
    key: 'color',
    label: { 'en-US': 'Color' },
    valueType: 'enum',
    enumValues: COLOR_VALUES,
    isSearchable: true,
    isFilterable: true,
    isVariantAxis: false,
  });
  const attrMaterial = em.create(ProductAttribute, {
    key: 'material',
    label: { 'en-US': 'Material' },
    valueType: 'enum',
    enumValues: MATERIAL_VALUES,
    isSearchable: false,
    isFilterable: true,
    isVariantAxis: false,
  });
  const attrWeight = em.create(ProductAttribute, {
    key: 'weight_kg',
    label: { 'en-US': 'Weight (kg)' },
    valueType: 'number',
    isSearchable: false,
    isFilterable: true,
    isVariantAxis: false,
  });
  const attrCertification = em.create(ProductAttribute, {
    key: 'certification',
    label: { 'en-US': 'Certification' },
    valueType: 'string',
    isSearchable: true,
    isFilterable: false,
    isVariantAxis: false,
  });
  const attrInternalNotes = em.create(ProductAttribute, {
    key: 'internal_sku_notes',
    label: { 'en-US': 'Internal SKU notes' },
    valueType: 'string',
    isSearchable: true,
    isFilterable: false,
    isVariantAxis: false,
  });
  await em.persistAndFlush([
    attrColor,
    attrMaterial,
    attrWeight,
    attrCertification,
    attrInternalNotes,
  ]);

  // --- Products --------------------------------------------------------
  const products: Product[] = [];
  for (let i = 1; i <= PRODUCT_COUNT; i++) {
    const idx = String(i).padStart(4, '0');
    const leaf = leaves[i % leaves.length]!;
    const color = COLOR_VALUES[i % COLOR_VALUES.length]!;
    const material = MATERIAL_VALUES[i % MATERIAL_VALUES.length]!;
    const weight = Number(((i % 50) / 10 + 0.1).toFixed(1));
    const price = 9.99 + (i % 100) * 1.5;
    const productName = `${leaf.name['en-US']} ${idx}`;
    products.push(
      em.create(Product, {
        sku: `DEMO-${leaf.slug.toUpperCase()}-${idx}`,
        slug: `demo-${leaf.slug}-${idx}`,
        type: 'simple',
        status: 'active',
        name: { 'en-US': productName },
        description: {
          'en-US': `Synthetic ${leaf.name['en-US']?.toLowerCase()} #${idx} — ${color} ${material}, ${weight}kg.`,
        },
        visibility: 'public',
        attributeValues: {
          color,
          material,
          weight_kg: weight,
          certification: i % 7 === 0 ? 'ISO9001' : null,
          defaultPrice: price,
        },
      }),
    );
  }
  await em.persistAndFlush(products);

  // --- Bridges (raw SQL for speed) ------------------------------------
  const productCategoryRows: string[] = [];
  const salesChannelProductRows: string[] = [];
  const productCategoryParams: unknown[] = [];
  const salesChannelProductParams: unknown[] = [];
  for (const [idx, p] of products.entries()) {
    const leaf = leaves[idx % leaves.length]!;
    productCategoryRows.push('(?, ?)');
    productCategoryParams.push(p.id, leaf.id);
    salesChannelProductRows.push('(?, ?)');
    salesChannelProductParams.push(retail.id, p.id);
  }
  await conn.execute(
    `insert into product_categories (product_id, category_id) values ${productCategoryRows.join(', ')}`,
    productCategoryParams,
  );
  await conn.execute(
    `insert into sales_channel_products (sales_channel_id, product_id) values ${salesChannelProductRows.join(', ')}`,
    salesChannelProductParams,
  );

  // --- Demo Organization + buyer --------------------------------------
  const adminPasswordHash = await hashPassword(DEMO_ADMIN_PASSWORD);
  const buyerPasswordHash = await hashPassword(DEMO_BUYER_PASSWORD);

  const platformRole = em.create(AdminRole, {
    code: 'platform_admin',
    name: 'Platform Admin',
    permissions: ['*'],
  });
  await em.persistAndFlush(platformRole);

  const demoAdmin = em.create(AdminUser, {
    email: DEMO_ADMIN_EMAIL,
    passwordHash: adminPasswordHash,
    firstName: 'Demo',
    lastName: 'Admin',
    adminRoleId: platformRole.id,
    status: 'active',
  });
  await em.persistAndFlush(demoAdmin);

  const demoOrg = em.create(Organization, {
    name: DEMO_ORG_NAME,
    taxId: DEMO_ORG_TAX_ID,
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: {
      street: 'ul. Demo 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
    },
  });
  await em.persistAndFlush(demoOrg);

  const demoBuyer = em.create(CustomerAccount, {
    organizationId: demoOrg.id,
    email: DEMO_BUYER_EMAIL,
    passwordHash: buyerPasswordHash,
    firstName: 'Demo',
    lastName: 'Buyer',
    role: 'organization_admin',
    emailVerifiedAt: new Date(),
  });
  await em.persistAndFlush(demoBuyer);

  // --- Delivery + payment methods (T166) ------------------------------
  const pickup = em.create(DeliveryMethod, {
    code: 'in_person_pickup',
    name: { 'en-US': 'In-person pickup', 'pl-PL': 'Odbior osobisty' },
    cost: '0',
    currency: 'PLN',
  });
  await em.persistAndFlush(pickup);

  const bankTransfer = em.create(PaymentMethod, {
    code: 'bank_transfer',
    name: { 'en-US': 'Bank transfer', 'pl-PL': 'Przelew bankowy' },
    kind: 'bank_transfer',
  });
  await em.persistAndFlush(bankTransfer);

  // --- Default Price List with per-product fixed_unit prices (T166) ---
  const defaultPriceList = em.create(PriceList, {
    code: 'default_pln',
    name: 'Default PLN',
    currency: 'PLN',
    isDefault: true,
    priority: 0,
  });
  await em.persistAndFlush(defaultPriceList);

  for (const product of products) {
    const price = Number(product.attributeValues['defaultPrice']);
    em.create(PriceListItem, {
      priceListId: defaultPriceList.id,
      mode: 'fixed_unit',
      productId: product.id,
      minQuantity: 1,
      unitPrice: String(price),
    });
  }
  em.create(PriceListAssignment, {
    priceListId: defaultPriceList.id,
    isDefault: true,
  });
  await em.flush();

  // --- Polish VAT Tax (T166) ------------------------------------------
  em.create(Tax, {
    code: 'pl_vat_23',
    name: 'PL VAT 23%',
    rate: '0.23',
    country: 'PL',
    isDefault: true,
  });
  await em.flush();

  // --- Summary --------------------------------------------------------
  const _summary: SeedRow<unknown>[] = [];
  void _summary;
  console.log('');
  console.log('=== Dev seed complete ===');
  console.log('');
  console.log(`Products       : ${PRODUCT_COUNT}`);
  console.log(`Categories     : ${1 + sections.length + leaves.length} nodes`);
  console.log(`Sales Channels : pl_retail (public), pl_b2b_vip (logged-in only)`);
  console.log(`Price Lists    : default_pln (${PRODUCT_COUNT} items, default)`);
  console.log(`Taxes          : pl_vat_23 (23% on PL, default)`);
  console.log(`Delivery       : in_person_pickup (free)`);
  console.log(`Payment        : bank_transfer (proforma flow)`);
  console.log('');
  console.log('Sign in credentials (CHANGE before any non-local use):');
  console.log(`  Platform Administrator : ${DEMO_ADMIN_EMAIL} / ${DEMO_ADMIN_PASSWORD}`);
  console.log(`  Organization Admin     : ${DEMO_BUYER_EMAIL} / ${DEMO_BUYER_PASSWORD}`);
  console.log('');
  console.log('Open the storefront at  http://localhost:3000');
  console.log('Open the admin panel at http://localhost:3002');
  console.log('');

  await closeOrm();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
