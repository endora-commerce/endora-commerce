---
sidebar_position: 1
slug: /
---

# B2B Platform — Introduction

Welcome. This site documents the **B2B Platform** — a Supplier-operated commerce product that supports both **Quote Request (RFQ)** and **direct-purchase** workflows on a single codebase, with Customer Organizations, multi-user Roles, Credit Limit settlement, a permissioned Admin Panel, and an open API + webhook layer for third-party ERP / PIM / WMS / CRM integrations.

## Who this is for

- **Developers** extending the platform — each module's section below describes its domain, contracts, services, and tests with enough depth to contribute without reverse-engineering the code.
- **Product Owners and end users** — the "Usage" page of each module is written to be understood without reading TypeScript.

Both audiences read the same tree. Sections marked _Developers_ vs _Usage_ let you skip the parts that are not for you.

## Where things live

| Artifact | Location |
| --- | --- |
| Governance source of truth | `.specify/memory/constitution.md` in the repository |
| Per-feature specs, plans, tasks, contracts | `specs/###-feature-name/` in the repository |
| Dev + prod runbook + hardware requirements | `README.md` at the repository root |
| Module documentation (you are here) | This site |

## Quick links

- Spec-Kit feature **001 — B2B Platform Foundation** — the spec, plan, and tasks that define the whole platform: `specs/001-b2b-platform-foundation/` in the repository.
- Live OpenAPI (when the backend is running): `http://localhost:3001/api/v1/_openapi.json`.

## Status

Feature **001 — B2B Platform Foundation** is **complete** end-to-end across User Stories 1–7:

- **Backend** ships catalog (Products / Categories / Attributes), search, RFQ lifecycle, cart + checkout + orders + invoices, organizations + members + invitations, admin Users & Roles + Audit Log + Impersonation, Shopping Lists + Quick Order, Credit Limits, integrations (API keys, webhooks, external integrations), CMS, SEO, languages + currencies, analytics — every module page below documents its public surface, and the live OpenAPI document at `GET /api/v1/_openapi.json` is the runtime contract.
- **Storefront** (Next.js) ships register / login / 2FA / password reset, account area, organization settings (members + addresses + pending invitations), cart, checkout (with credit-limit-aware payment-method visibility), order confirmation + history, RFQ list + detail with the PDP "Request a quote" widget, shopping lists with bulk convert-to-cart / convert-to-RFQ, quick-order CSV importer, and the impersonation banner.
- **Admin panel** (Vite + React) ships Products / Categories / Attributes, Inventory, Organizations, Orders, Invoices, Quote Requests (Claim / Send Quote / Decline), Price Lists / Taxes / Promotions, Delivery + Payment Methods, Credit Limits, Users + Roles with a permissions matrix, Audit Log viewer, Impersonation banner, plus API Keys / Webhooks / Integrations / Analytics / SEO / Languages / CMS modules.

Per the constitution's Documentation Requirements: PRs that add or change a module MUST update the relevant page in the same commit range.

## About this site

This is the public documentation of Endora Commerce, published at `https://docs.commerce.endora.software/` in English and Polish: it is built with Docusaurus from the documentation sources kept in the product's own repository — the site's own pages under `docs/`, plus one documentation directory per module, collected at build time — so a page and the code it describes change together.
