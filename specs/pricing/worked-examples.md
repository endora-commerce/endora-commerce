# Pricing — worked examples and test vectors

The product owner's three target scenarios (E1–E3) and the cases that chose the precedence (F, S, T, Q vectors), and the cases the owner's rulings of 2026-10-21 decide (C∩, configurable precedence, H, A, K, U, V, D vectors), each as **inputs → expected price → which row wins and why**, under the proposed model, with today's answer where it differs. They are written to become the failing-first tests of the pricing-model feature (Constitution III) and to answer "what should this cost?" without re-deriving the algorithm.

**Verified against** `master` at `b1021c71b` on 2026-10-21; §10.11 re-checked for the P0 read-path hardening (branch `fix/pricing-read-path-hardening` on `fd6255339`) on 2026-10-21; §10.16 re-checked at `e3f456957` on 2026-10-24 (vectors G1–G4). §10.17 written against `2716908b3` on 2026-10-24 (issue #417) and rewritten for the owner's VAT ruling of the same day. File:line citations are as of `b1021c71b`; re-check them before relying on one.

**The "Today" lines** under each vector record what the **pre-160** engine (the Application rule
and the Default list) answered, as the comparison the model was decided against. Since feature 160
the shipped engine answers the **Expected** column (`current-model.md`); the vectors are its tests
under `backend/test/integration/price_lists/worked-examples/`, and the demo reproduces E1–E3
(`backend/test/integration/price_lists/demo-scenarios.test.ts`).

**Section numbers.** `§N` references follow the numbering of the original analysis, which is split across this directory: §1 → `current-model.md`; §2 → `read-paths-and-performance.md` (its summary table); §3–§9, §11, §12 → `decision-record.md`; §10 → `worked-examples.md`. `read-paths §N` points into `read-paths-and-performance.md`, `peers §N` into `peer-platforms.md`. Path abbreviations: `PL/` = `packages/modules/price_lists/src/`, `CON/` = `packages/contracts/src/`, `CAT/` = `packages/modules/catalog/src/`, `SF/` = `storefront/`.

---

## 10. Worked examples as test vectors

### 10.1 Fixture (shared)

- Channel **CH** "B2B PL", default currency PLN; currency **PLN**.
- Category **Screws**; category **Bolts**.
- Attribute **color**: `select`, `isPriceRule = true`, not language- or channel-scoped.
- Products (own category assignments, own attribute values):
  - **P1** *Screws 0200* — {Screws}, color = red
  - **P2** *Screws 0300* — {Screws}, color = blue
  - **P3** *Bolt 10* — {Bolts}, color = red
- Base book PLN: P1 `1+ : 100.0000`; P2 `1+ : 50.0000`; P3 `1+ : 30.0000`.
- Customer group **VIP**. Organizations: **Acme** *Acme B2B (demo)* (group VIP, no parent),
  **Beta** (group VIP), **Gamma** (no group), **AcmeW** (child of Acme, group VIP). Guest = no org.
- Quantity 1 unless stated. Amounts in PLN; percentages half-up to 4 dp. Percentages are signed
  adjustments (`decision-record.md` §5.1): `percent −10` is a 10 % discount, `percent +20` a 20 %
  surcharge.
- Precedence: §10.2–§10.8 are stated under the **AF** preset (*Audience first*) unless a vector
  names another. Under **HY**, the default preset (N11), every one of them gives the same answer
  except F1 (70.00 instead of 98.00); §10.10 shows every case where the presets differ.
- Audiences are sets of one kind; "audience org Acme" means the set {Acme}.

### 10.2 E1 — category ∩ attribute price for everyone

Config: list **L1** regular, CH, PLN, audience everyone, priority 0. Row **e1**: selection
{category Screws ∩ color = red}, `1+`, fixed `120`.

| Vector | Buyer | Product | Steps | Expected | Winner |
| --- | --- | --- | --- | --- | --- |
| E1.1 | guest | P1 | b = 100; catalogue candidates {e1 (spec 4) = 120} → C = 120; no buyer rows → R = 120; no sale | **120.00** | L1/e1, tier catalogue |
| E1.2 | guest | P2 | e1 no match (blue) → C = b = 50 | **50.00** | base |
| E1.3 | guest | P3 | e1 no match (not in Screws) → C = 30 | **30.00** | base |
| E1.4 | Acme | P1 | C = 120; Acme has no list → R = C | **120.00** | L1/e1 |

Today: e1 as a matrix entry on the Default list resolves **100.00** — the own bracket
(orgRank ∞, specificity 4) outranks the entry (orgRank ∞, specificity 3)
(`matrix-price-resolver.ts:242-251, 205-208`). Working today needs a second list with a non-empty
rule (e.g. `salesChannel = CH`, since `{kind:'all'}` cannot be activated, `price-list-service.ts:566`),
no own bracket for P1, and e1 on it: that list wins at level 4 over Default at level 5 → 120.00.
Q2 ruled that `color` is an `isPriceRule` attribute; if it is also a variant axis, the proposal matches
it on the variant's value (V3, §10.14) — not expressible today, where the engine ignores variants.

### 10.3 E2 — organization × category %, organization × product %

Config (without E1): list **L2** regular, CH, PLN, audience org Acme. Rows **e2a** category Screws
`1+` percent −10; **e2b** product P1 `1+` percent −20.

| Vector | Buyer | Product | Steps | Expected | Winner |
| --- | --- | --- | --- | --- | --- |
| E2.1 | Acme | P1 | C = 100; buyer candidates level 0: e2b (spec 5) = 80, e2a (spec 3) = 90 → e2b | **80.00** | L2/e2b |
| E2.2 | Acme | P2 | C = 50; e2a = 45 | **45.00** | L2/e2a |
| E2.3 | Acme | P3 | no row matches → R = C = 30 | **30.00** | base |
| E2.4 | Beta | P1 | no Beta/VIP list → 100 | **100.00** | base |
| E2.5 | Acme | P1, **with E1 also configured** | C = 120 (e1); e2b = 120 × 0.80 | **96.00** (Q3 ruled: off the catalogue price; "off base" would give 80.00) | L2/e2b |

Today: same answers for E2.1–E2.4 (list L2 with rule `organization = Acme`, entries with
`organization_id = Acme`; reference = Default bracket, `matrix-price-resolver.ts:235-239`). E2.5 today
= 80.00 (reference is the Default list, not L1).

### 10.4 E3 — group × product vs organization × product vs organization × category

Config (fresh, no E1/E2): list **L3** regular, CH, PLN, audience group VIP: **e3a** product P1 `1+`
percent −10. List **L4** regular, CH, PLN, audience org Acme: **e4a** product P1 `1+` percent −5;
**e4b** category Screws `1+` percent −15.

| Vector | Buyer | Product | Candidates (cell, chain depth, amount) | Expected | Winner |
| --- | --- | --- | --- | --- | --- |
| E3.1 | Acme | P1 | e4a (org.product, 0, 95), e4b (org.category, 0, 85), e3a (group.product, —, 90) | **95.00** under every preset | L4/e4a — org.product is the best-ranked cell in AF, SF and HY |
| E3.2 | Beta | P1 | e3a (group.product, —, 90) | **90.00** | L3/e3a |
| E3.3 | Acme | P2 | e4b (org.category, 0, 42.50) | **42.50** | L4/e4b |
| E3.4 | Acme | P2, plus **e3b** VIP product P2 percent −10 | e4b (org.category, 0, 42.50), e3b (group.product, —, 45.00) | **42.50** under AF and HY; 45.00 under SF (§10.10) | L4/e4b |
| E3.5 | Gamma, guest | P1 | none | **100.00** | base |
| E3.6 | AcmeW | P1 | chain [AcmeW, Acme]: e4a (org.product, 1, 95), e3a (group.product, —, 90) | **95.00** | L4/e4a (inherited) |

Tension spelled out: for P1 the three rules agree on 95.00 under both orderings (org × product is
the most specific *and* the nearest audience). The orderings diverge on E3.4, where the
organization's category deal meets the group's product deal; audience-first honours the negotiated
contract (42.50). The mirror failure of audience-first in a single tier (F2 below) is what the
tier split removes.

Today: VIP's "−10 % on P1" is only expressible as an own bracket fixed `90.0000` on a list with rule
`customerGroup = VIP` (product entries need an organization, `CON/price-lists.ts:266-273`; no group
coordinate). L4 = rule `organization = Acme` + entries product×Acme 5 % and category×Acme 15 %. Acme:
L4 (level 1) beats L3 (level 2) → in L4 e4a beats e4b → **95.00**; E3.3/E3.4 → **42.50**; same answers.

### 10.5 Failure cases that chose the precedence

| Vector | Config | Single-tier audience-first | Single-tier specificity-first | **Proposed (tiered, AF)** |
| --- | --- | --- | --- | --- |
| F1 | Acme list: all products −2 %; VIP list: P1 −30 % | 98.00 (Acme pays more than other VIPs) | 70.00 | **98.00** under AF — the HY and SF presets give 70.00 (§10.10); under AF the remedy is a VIP *sale* list (min rule) or an Acme row for P1 |
| F2 | CH everyone list: P1 fixed 90; Acme list: all products −3 % | 97.00 (logging in raises the price) | 90.00 (loses the 3 %) | **87.30** (C = 90, −3 %) |
| F3 | = E3.4 | 42.50 | 45.00 | **42.50** |
| F4 | CH everyone list: P2 fixed 48; Acme list: category Screws −15 % | 42.50 | 48.00 (contract ignored) | **40.80** (C = 48, −15 %) |

### 10.6 Sale

Config E3 + list **L5** sale, CH, PLN, audience everyone: **e5** all products percent −10.

| Vector | Buyer | Product | R | S | Expected | Display |
| --- | --- | --- | --- | --- | --- | --- |
| S1.1 | Acme | P1 | 95 | 90 | **90.00** | compare-at 95.00 |
| S1.2 | Beta | P1 | 90 | 90 | **90.00** | no sale (not strictly lower) |
| S1.3 | guest | P1 | 100 | 90 | **90.00** | compare-at 100.00 |
| S2 | Acme | P1, e5 replaced by fixed P1 98 | 95 | 98 | **95.00** | no sale. **Today: 98.00** (`pricing-service.ts:88-110`) |

### 10.7 Priority

| Vector | Config | Expected |
| --- | --- | --- |
| T1 | E3 + list **L6** regular, org Acme, priority 10, row P1 fixed 97 | Acme P1: e4a (0, 5, prio 0, 95) vs L6 row (0, 5, prio 10, 97) → **97.00** |
| T2 | same, L6 priority 0 | equal priority, equal min qty → lower amount → **95.00** |
| T3 | L6 row is category Screws fixed 97, priority 10 | spec beats priority: e4a (spec 5) → **95.00** |

Today the T1 situation is decided by `modifiedAt` (`price-list-resolver.ts:59-69`); renaming L4
flips it.

### 10.8 Quantity tiers and fall-through

Base P1 changed to `1–9 : 100`, `10+ : 90`.

| Vector | Config | Buyer, qty | Expected |
| --- | --- | --- | --- |
| Q1 | L4 e4a P1 −5 % `1+` | Acme, 10 | C = 90 → **85.50** |
| Q2 | L4 P1: −5 % `1–99`, −8 % `100+` | Acme, 100 | C = 90 → **82.80** |
| Q3 | L4 P1 only fixed 70 `100+`; e4b category −15 % | Acme, 50 | P1 row does not cover 50 → e4b → 90 × 0.85 = **76.50** |
| Q3b | same | Acme, 100 | P1 row (spec 5) → **70.00** |
| Q4 | P4 in Screws with **no base PLN**; e4b | Acme, 1 | e4b needs C, none → skipped → R undefined → **unpriced** (quote path) |

### 10.9 Is *Category ∩ Attribute* needed? (Q7 follow-up)

E1 written without the intersection kind, on list **L1** (regular, CH, PLN, everyone):

| Vector | Config instead of e1 | Guest P1 (red screw) | Guest P2 (blue screw) | Guest P3 (red bolt) | Verdict |
| --- | --- | --- | --- | --- | --- |
| C∩0 | e1 = category Screws ∩ color red, fixed 120 | **120.00** | **50.00** | **30.00** | correct |
| C∩1 | attribute color = red, fixed 120 | 120.00 | 50.00 | **120.00** ✗ (should be 30.00) | the red bolt is repriced |
| C∩2 | category Screws, fixed 120 | 120.00 | **120.00** ✗ (should be 50.00) | 30.00 | the blue screw is repriced |
| C∩3 | product P1, fixed 120 | 120.00 | 50.00 | 30.00 | correct today; a red screw added tomorrow is **not** covered |

Conclusion recorded in `decision-record.md` §5.10: the kind stays, limited to one category and one
attribute value.

### 10.10 Configurable precedence — the cases where the presets differ

Presets (`decision-record.md` §5.6): **AF** audience first, **SF** specificity first, **HY** contract
first, blanket last (**default**, N11), **AF-N** audience first with nearest-organization-first
depth. Toggle **cat>attr** (default) / **attr>cat**.

**N11 evidence — the owner's scenarios under every preset.** "Owner" is the answer the owner's own
wording fixes; a preset is eligible only if it matches every row.

| Vector | Owner's wording | Owner | AF | SF | HY | AF-N |
| --- | --- | --- | --- | --- | --- | --- |
| E1.1 | red in Screws → 120 | 120.00 | 120.00 | 120.00 | 120.00 | 120.00 |
| E1.2 | blue screw keeps its base | 50.00 | 50.00 | 50.00 | 50.00 | 50.00 |
| E1.3 | red bolt keeps its base | 30.00 | 30.00 | 30.00 | 30.00 | 30.00 |
| E2.1 | Screws 0200 −20 % for Acme | 80.00 | 80.00 | 80.00 | 80.00 | 80.00 |
| E2.2 | other screws −10 % for Acme | 45.00 | 45.00 | 45.00 | 45.00 | 45.00 |
| E3.1 | "for Acme, which belongs to VIP, Screws 0200 5 % cheaper, not 10 %" | 95.00 | 95.00 | 95.00 | 95.00 | 95.00 |
| E3.2 | VIP member without own terms: −10 % | 90.00 | 90.00 | 90.00 | 90.00 | 90.00 |
| E3.3 | "products in Screws −15 % for Acme" | 42.50 | 42.50 | 42.50 | 42.50 | 42.50 |
| E3.4 | the same sentence, on a screw VIP has its own −10 % for | 42.50 | 42.50 | **45.00 ✗** | 42.50 | 42.50 |

SF is out (E3.4). Among AF, HY and AF-N the F vectors decide:

| Vector | Config | Buyer / product | AF | SF | HY | AF-N |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Acme list: all products −2; VIP list: P1 −30 | Acme / P1: org.all 98.00 vs group.product 70.00 | 98.00 ✗ | 70.00 | **70.00** | 98.00 ✗ |
| F2 | CH everyone list: P1 fixed 90; Acme list: all products −3 | Acme / P1: catalogue C = 90, only org.all | 87.30 | 87.30 | **87.30** | 87.30 |
| F3 | = E3.4 | | 42.50 | 45.00 | **42.50** | 42.50 |
| F4 | CH everyone list: P2 fixed 48; Acme list: category Screws −15 | Acme / P2: C = 48, only org.category | 40.80 | 40.80 | **40.80** | 40.80 |
| F5 | Acme list: all products −2; VIP list: category Screws −5 | Acme / P2: org.all 49.00 vs group.category 47.50 | 49.00 ✗ | 47.50 | **47.50** | 49.00 ✗ |

✗ in F1/F5 marks the anomaly "an Acme buyer pays more than any other VIP member because Acme has a
small blanket discount". HY is the only preset with no ✗ in either table, hence the default.

F2 and F4 do not depend on the preset: the everyone price is the catalogue tier, below every buyer
cell. The presets only order buyer cells against each other.

Category/attribute toggle (applies in every tier, every preset):

| Vector | Config | Buyer / product | cat>attr | attr>cat |
| --- | --- | --- | --- | --- |
| C1 | Acme list: category Screws −10; attribute color = red −20 | Acme / P1 (red, in Screws) | **90.00** (org.category) | **80.00** (org.attribute) |
| C2 | CH everyone list: category Screws fixed 110; attribute color = red fixed 125 | guest / P1 | **110.00** | **125.00** |

Chain depth (N6):

| Vector | Config | Buyer / product | AF, SF, HY (within cell) | AF-N (nearest organization first) | Today |
| --- | --- | --- | --- | --- | --- |
| H1 | list {AcmeW}: category Screws −7; list {Acme}: product P1 −5 | AcmeW / P1: org.product (depth 1) 95.00 vs org.category (depth 0) 93.00 | **95.00** — the cell outranks the depth | **93.00** — the own organization outranks the cell | 93.00 — the nearest organization's list is picked first (`price-list-resolver.ts:41-52`) |
| H2 | list {AcmeW}: product P1 −7; list {Acme}: product P1 −5 | AcmeW / P1: both org.product | **93.00** (depth 0 beats depth 1) | **93.00** | 93.00 |
| H3 | configuration HY + `nearest_organization_first` | — | — | refused `400 VALIDATION_FAILED` (I5) | — |

### 10.11 Audience sets (Q1)

| Vector | Config | Buyer | Product | Expected | Why |
| --- | --- | --- | --- | --- | --- |
| A1.1 | **L8** regular, CH, PLN, organizations {Acme, Beta}: P1 −12 | Acme | P1 | **88.00** | member |
| A1.2 | same | Beta | P1 | **88.00** | member |
| A1.3 | same | AcmeW | P1 | **88.00** | Acme is in its chain (depth 1) |
| A1.4 | same | Gamma | P1 | **100.00** | not a member |
| A2.1 | **L9** regular, CH, PLN, customer groups {VIP, Gold}: P2 −20 | Beta (VIP), customer without own group | P2 | **40.00** | effective group VIP |
| A2.2 | same | customer *Ola* of Gamma with own group Gold | P2 | **40.00** | effective group Gold (customer's own group wins) |
| A2.3 | same | customer of Beta with own group Silver (no list) | P2 | **50.00** | effective group is Silver, not Beta's VIP — one effective group |
| A3.1 | rep scoped to {Acme}; L10 organizations {Acme} | — | — | editable | all members in scope |
| A3.2 | same rep; L8 {Acme, Beta} | — | — | **not visible** (answers as missing, N3) | a member out of scope |
| A3.3 | same rep; L9 groups {VIP, Gold} | — | — | read-only | not an organization list |
| A3.4 | same rep; a draft organization book naming no organization | — | — | **not visible** (answers as missing) | names none of the rep's organizations; a rep cannot create, duplicate or patch to such an audience (`400`), nor patch their own draft to everyone or groups (`403`) — review finding 4 |
| A4 | create a list with members of two kinds (Acme and VIP) | — | — | refused `400 VALIDATION_FAILED` | one kind per list |

The effective-group rule of A2.1–A2.3 (the customer's own group, else the organization's — one
group, never both) already holds on the **current** model since P0, on every entry point
(`current-model.md` §1.2): the current-model vectors are
`backend/test/integration/price_lists/line-prices-batch.test.ts` (own group wins; an account of
another organization is ignored) and `customer-own-group-every-path.test.ts` (listing, product
detail, `resolved-price`, cart). P1 keeps the rule and moves the audience onto the header.

### 10.12 Channel sets and currency (Q5)

Channels: **CH1** "B2B PL" currencies [PLN]; **CH2** "B2C PL" [PLN, EUR]; **CH3** "EU" [EUR].
List **L11** regular, PLN, everyone, channels {CH1, CH2}: P2 fixed 48.

| Vector | Situation | Request | Expected |
| --- | --- | --- | --- |
| K1.1 | as configured | guest, CH1, PLN, P2 | **48.00** |
| K1.2 | as configured | guest, CH2, PLN, P2 | **48.00** |
| K1.3 | as configured | guest, CH2, EUR, P2, no EUR base row | **unpriced** (no EUR price anywhere) |
| K2 | create a PLN list with channels {CH1, CH3} | — | refused `400 VALIDATION_FAILED` naming CH3 |
| K3.1 | CH2 later drops PLN | guest, CH1, PLN, P2 | **48.00** (CH1 binding unaffected) |
| K3.2 | same | engine asked for (CH2, PLN) | **unpriced** — the channel no longer offers PLN; the guard fails closed; admin shows the CH2 binding *Inactive* |
| K3.3 | CH2 adds PLN back | guest, CH2, PLN, P2 | **48.00** again, with no write to L11 |

### 10.13 Surcharges and amount adjustments (Q6)

| Vector | Config | Buyer / product | Expected |
| --- | --- | --- | --- |
| U1.1 | CH everyone list: attribute color = red percent +20 | guest / P1 | **120.00** |
| U1.2 | same | guest / P3 | **36.00** |
| U1.3 | same | guest / P2 | **50.00** |
| U2.1 | Acme list: product P1 percent +10 | Acme / P1 | **110.00** (C = 100) |
| U2.2 | U2.1 + L5 (sale, everyone, all products −10) | Acme / P1 | S = 90 < R = 110 → **90.00**, compare-at 110.00 |
| U3.1 | CH everyone list: product P2 amount −5 | guest / P2 | **45.00** |
| U3.2 | CH everyone list: product P2 amount −60 | guest / P2 | row result −10 < 0 → row unpriced (flagged) → **50.00** |
| U4 | Acme list: product P1 percent −100 | Acme / P1 | **0.00** (a free line, valid) |

### 10.14 Variants (#377)

Fixture addition: **P5** *Screws 0500*, a configurable product in {Screws}; attribute **color** is a
variant axis (`isVariantAxis`) and `isPriceRule`; variants **P5r** (color red) and **P5b** (color
blue); the product itself carries no color. Base book PLN: P5 `1+ : 80.0000`; variant row P5r
percent +10 (off the parent's base).

| Vector | Config | Buyer / line | Expected | Why |
| --- | --- | --- | --- | --- |
| V1 | base only | guest / P5b | **80.00** | inherits the product's base |
| V2 | base only | guest / P5r | **88.00** | variant base row: 80 × 1.10 |
| V3 | + e1 (Screws ∩ red fixed 120) | guest / P5r | **120.00** | e1 matches through the variant's axis value; catalogue tier beats base |
| V3b | same | guest / P5b | **80.00** | blue |
| V4 | Acme list: product P5 −5 | Acme / P5r | **83.60** | 88 × 0.95 — percentages keep variant differences |
| V4b | same | Acme / P5b | **76.00** | 80 × 0.95 |
| V5 | V4 + Acme list: variant P5r fixed 85 | Acme / P5r | **85.00** | org.variant beats org.product |
| V6 | Acme list: product P5 fixed 70 | Acme / P5r and P5b | **70.00** each | a fixed product price flattens variants (N1) |
| V7 | base book: variant P5b amount +7 | guest / P5b | **87.00** | 80 + 7 |
| V8 | base only | guest, listing card for P5 | "from **80.00**", max 88.00 | `variesByVariant`; sort and range key 80.00 (N8) |
| V9 | V4 | Acme, cart line P5r | **83.60** | resolved with the line's `variant_id`. **Today**: the engine ignores the variant and charges P5's own price, while the PDP picker shows `price_override` (`SF/components/VariantPicker.tsx:83-86`) |

### 10.15 "List price / your price" display (Q8a)

| Vector | `pricing.show_list_price` | Buyer / product (config) | Card shows |
| --- | --- | --- | --- |
| D1 | false (default) | Acme / P1 (E3) | **95.00** only |
| D2 | true | Acme / P1 (E3) | list **100.00** / your price **95.00** |
| D3 | true | Acme / P1 (U2.1, surcharge) | **110.00** only — the list price is shown only when above yours (N4) |
| D4 | true | guest / P1 (no lists) | **100.00** only — list price equals your price |
| D5 | true | Acme / P1 (E3) with a sale of **80.00** charged | list ~~**100.00**~~ / your price **80.00** — two prices only: Acme's regular 95.00 is not shown (owner ruling 2026-10-23) |
| D6 | false | Acme / P1 (E3) with the same sale | ~~**95.00**~~ **80.00** — unchanged: the sale strikes the buyer's own price |

### 10.16 Two-place rounding of an x.xx50 amount

A resolver amount is four places; every surface that shows or stores it at two rounds it **half-up
on its decimal digits** (`roundAmountHalfUp`, `CON/price-book-decimal.ts`), which is also what the
storefront's `Intl.NumberFormat` shows. `Number(amount).toFixed(2)` rounds the binary double and
is not this rule: 9.0450 is the double 9.04499…, so it gave 9.04.

| Vector | Config | Buyer / product | Resolver | Card, product page, cart line, order (copied from the cart), order preview, quote reference, feed |
| --- | --- | --- | --- | --- |
| R1 | everyone catalogue book: product fixed 10.05; everyone sale: product −10 % | any / product | **9.0450** | **9.05** (`toFixed`: 9.04) |
| R2 | everyone sale: product fixed 1.005 | any / product | **1.0050** | **1.01** (`toFixed`: 1.00) |

Test: `backend/test/integration/price_lists/worked-examples/rounding.test.ts`.

**Gross at two places** (review 2 of release 0.108.0, finding 2). A gross price is computed, not
read: `net × (1 + rate / 100)`, rounded to two places **half-up on the exact decimal product**
(`grossAmountHalfUp`, beside `roundAmountHalfUp`). Gross is the default product-feed presentation,
and the storefront's gross beside a net price is the same function, so the two agree. Rounding the
binary double is not this rule: 29.50 × 1.23 is the double 36.28499…, and
`Math.round(x * 100) / 100` gave 36.28.

| Vector | Net | Rate | Exact product | Gross (feed, storefront) | Binary (`Math.round`) |
| --- | --- | --- | --- | --- | --- |
| G1 | 29.50 | 23 % | 36.2850 | **36.29** | 36.28 |
| G2 | 4.30 | 5 % | 4.5150 | **4.52** | 4.51 |
| G3 | 31.50 | 23 % | 38.7450 | **38.75** | 38.74 |
| G4 | 16.50 | 23 % | 20.2950 | **20.30** | 20.29 (also what `Intl.NumberFormat` showed) |

Tests: `packages/contracts/test/price-book-decimal.unit.test.ts`,
`packages/modules/product_feeds/src/backend/services/feed-gross-price.test.ts`,
`storefront/test/lib/gross-derivation.test.ts`. Tax, totals and the documents an order produces
are §10.17.

### 10.17 Money computed from a price — lines, tax, totals and documents (issue #417)

Every amount computed from a price — a line's net and gross, a tax, a total, a correction, a refund,
an available credit, a discount — is computed in exact decimal arithmetic and rounded half-up (half
away from zero for a negative amount) once, where its rule says (`CON/money-decimal.ts`, beside
`price-book-decimal.ts`).

**One VAT method, everywhere** (owner ruling of 2026-10-24; art. 106e ust. 1 pkt 13–14 of the
Polish VAT Act): **per rate, the VAT is the sum of the net amounts at that rate times the rate,
rounded half-up once; the rate's gross is its net plus its VAT; the totals are the sums of the
rows.** One function computes it, `vatByRate` (`CON/money-decimal.ts`), and every document an order
produces calls it:

| Document | What it computes with `vatByRate` |
| --- | --- |
| Checkout preview, admin preview, placed order | `taxTotal` over the lines' nets; `total` = net + VAT + delivery + surcharge − discount (those three carry no VAT); the payment, the proforma and the credit reservation take that `total`; `orders.vat_method = 'per_rate'` records it |
| Order line (`order_items.line_total`), confirmation, order screens | the line's **own rounding**, `round(net × (1 + rate))` — informational (owner ruling of 2026-10-24): the line grosses may add up to a cent more or less than the total |
| VAT invoice | the per-rate summary and the totals over the lines' nets (delivery, surcharge and discount are 0 % lines), stored as issued in `invoices.vat_summary`; a line's `grossValue` is its own rounding, informational — the law requires the net per line, the gross per line is optional; `paidTotal` is what was paid for the order (the captured payments, or a paid order's stored total), never the invoice gross |
| Return (default refund) | **cumulative** over the order's returns: per group of what the order charged — a rate (`vat_method = 'per_rate'`) or a line (an order placed before) — the amount of everything returned so far (`vatByRate` over the returned nets, or the stored line total in proportion) minus what earlier returns refunded in the group; capped at what remains of the stored products total, and a completing return refunds exactly what remains |
| Correction | **cumulative** over the corrections of one invoice: per rate (per line for an invoice issued before) the net of everything credited so far — `netForGrossAtRate`, `N` with `N + round(N × rate) = gross`, or the invoiced line net in proportion — minus the nets earlier corrections credited; capped at what remains of the invoice; a total above the lines' sum is refused |
| Quote screens and PDF | the quote has one rate: the summary's VAT on the net total; a line's own VAT column is rounded per line, informational |

A typed money amount has at most two decimal places; more is refused with
`400 AMOUNT_PRECISION_EXCEEDED`, never rounded (`CON/money-input.ts`). Price-book prices keep their
four-place grammar (§10.16).

The resolver amount is rounded to the cart line's two places first (§10.16). At 8 % no two-place net
has an exact half cent of tax (8 × cents ÷ 100 never ends in .5), so the binary failures were at 23 %
and 5 %. Each order carries a 2.50 payment surcharge and no delivery cost; 102 is a `virtual`
product, which is how one order carries two rates.

| Vector | Lines (resolver × qty, rate) | Cart lines | Order: line gross / VAT / total — = payment, proforma, invoice gross, invoice paid | Invoice rows (net / VAT / gross) | Returns → corrections (gross / net / VAT) | Before #417 |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | 29.4950 × 1, 23 % | **29.50** | **36.29** / **6.79** / **38.79** | 23 %: 29.50 / 6.79 / 36.29 | all: 36.29 / 29.50 / 6.79 | order line gross 36.28 (`toFixed`) |
| A2 (V3 full) | 9.0450 × 3, 8 % | **27.15** | **29.32** / **2.17** / **31.82** | 8 %: 27.15 / 2.17 / 29.32 | all 3: **29.32** / 27.15 / 2.17 | cart `27.150000000000002`; the default refund was 9.77 × 3 = 29.31 |
| A3 | 0.6950 × 1, 5 % | **0.70** | **0.74** / **0.04** / **3.24** | 5 %: 0.70 / 0.04 / 0.74 | all: 0.74 / 0.70 / 0.04 | VAT 0.03, total 3.23, line gross 0.73 |
| V2 | 29.4950 × 1, 23 % + 0.6950 × 1, 5 % | 29.50, 0.70 | 36.29, 0.74 / **6.83** / **39.53** | 5 %: 0.70 / 0.04 / 0.74; 23 %: 29.50 / 6.79 / 36.29 | all: 37.03 / 30.20 / 6.83 | the order took 6.785 + 0.035 = 6.82 and 39.52; the invoice 6.83 and 39.53 |
| V3 partial | 9.0450 × 3, 8 %; 2 returned, then 1 | 27.15 | as A2 | as A2 | 2 of 3: **19.55** / 18.10 / 1.45; then 1: **9.77** / 9.05 / 0.72 | the default refund was 9.77 × 2 = 19.54 |
| L1 | 29.4950 × 1 + 0.6950 × 5, both 23 % | 29.50, 3.50 | **36.29**, **4.31** (= 40.60) / **7.59** / **43.09** | 23 %: 33.00 / 7.59 / 40.59 | all: 40.59 / 33.00 / 7.59 | the line grosses were the allocated 36.28, 4.31 |
| R2 | 29.4950 × 2, 23 %; 1 returned, then 1 | 59.00 | **72.57** / **13.57** / **75.07** | 23 %: 59.00 / 13.57 / 72.57 | 1: **36.29** / 29.50 / 6.79; then 1: **36.28** / 29.50 / 6.78 | each case alone refunded 36.29, 72.58 against 72.57 paid |
| L0 | placed before 0.108.0: 29.50 at 23 % (stored 36.29) + 4.30 at 5 % (4.52); stored VAT 7.00, total 40.80, 40.80 paid | — | as stored | issued now: 23 %: 29.50 / 6.79; 5 %: 4.30 / 0.22 — **7.01**, **40.81**; paid **40.80**, due **0.01** | all: refunds 36.28, 4.52 = **40.80** (what was paid) → **40.80** / 33.80 / 7.00 | the context recomputed what was paid; `paidTotal` was the invoice gross, 40.81 |

V2 is the case the two rules disagreed on: the order summed every line's exact tax across all rates
and rounded once, the invoice rounded each line's gross and took a rate's VAT as Σ gross − Σ net, so
the invoice's gross and its recorded paid amount were a cent above what the buyer paid. Under the one
method it is one figure, 39.53, on every document. L1 is the cent the owner accepted on 2026-10-24:
each line shows its own rounding, and the lines may add up to a cent more or less than the total. The same order of 29.50 at 23 % and 4.30 at 5 % is
6.79 + 0.22 = **7.01** VAT and **40.81** gross, and three lines of 0.02 at 23 % carry **0.01** VAT
(0.06 × 0.23 = 0.0138), where rounding each line gave 0.00.

Before #417 every invoice of a VAT-payer order also read the order line's **gross** `line_total` as
its net and taxed it again (D1): 100.00 net at 23 % was invoiced at 123.00 net, 151.29 gross.
Invoices issued before the fix are not rewritten or corrected (owner ruling of 2026-10-24); they are
shown with the per-rate summary derived from their stored lines, as they were issued
(`readModelVatSummary`, decided by `invoices.vat_summary` being `null`). An order placed before is
read from what it stored (`orders.vat_method` `null`): L0.

Tests: `backend/test/integration/price_lists/worked-examples/money-agreement.test.ts` (A1–A3, V2,
V3 full and partial, L1, R2, L0, every document, and the identity of the payment, the proforma, the
order total and the invoice's gross and paid total); `packages/contracts/test/money-decimal.unit.test.ts`
(`vatByRate`, `allocateHalfUp`, `netForGrossAtRate`) and `money-input*.unit.test.ts`;
`packages/modules/orders/src/backend/services/order-money.test.ts` and `order-return-context.test.ts`;
`packages/modules/invoices/src/backend/services/vat-summary.test.ts` and `correction-amounts.test.ts`;
`packages/modules/returns/src/backend/domain/cumulative-refunds.test.ts` (800 random return
sequences never over-refund, and a complete return refunds exactly what was paid);
`backend/test/integration/invoices/decimal-amounts.test.ts` (D1, V2).
