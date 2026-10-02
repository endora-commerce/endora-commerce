---
sidebar_position: 1
slug: /
---

# B2B Platform — Introduction

Welcome. This site documents the **B2B Platform** — a Supplier-operated commerce product that supports both **Quote Request (RFQ)** and **direct-purchase** workflows on a single codebase, with Customer Organizations, multi-user Roles, Credit Limit settlement, a permissioned Admin Panel, and an open API + webhook layer for third-party ERP / PIM / WMS / CRM integrations.

## Start here

1. [Getting started](./getting-started.md) — one command installs an instance on your machine: an
   API, an admin panel and a storefront. What it asks, what you get and where to sign in.
2. [Standing the components up separately](./getting-started.md#one-component-per-machine) — the
   API, the admin and the storefront on machines of their own, under a name each or on one host
   with paths.
3. [Create your first Module](./create-your-first-module.md) — a 20-minute tutorial that extends
   the instance with a module of your own.
4. [First production deployment checklist](./deployment/first-deployment-checklist.md) — before
   the instance takes real orders.

## Who this is for

- **Developers** extending the platform — each module's section below describes its domain, contracts, services, and tests with enough depth to contribute without reverse-engineering the code.
- **Product Owners and end users** — the "Usage" page of each module is written to be understood without reading TypeScript.

Both audiences read the same tree. Sections marked _Developers_ vs _Usage_ let you skip the parts that are not for you.

## Where things live

| Artifact | Location |
| --- | --- |
| Installing an instance | [Getting started](./getting-started.md) |
| Hardware requirements, and working on Endora Commerce itself | `README.md` at the repository root |
| Module documentation (you are here) | This site |

## Quick links

- Live OpenAPI (when the API is running, on its default port): `http://localhost:3001/api/v1/_openapi.json`.

## Status

The platform foundation is **complete** end to end:

- **Backend** ships catalog (Products / Categories / Attributes), search, RFQ lifecycle, cart + checkout + orders + invoices, organizations + members + invitations, admin Users & Roles + Audit Log + Impersonation, Shopping Lists + Quick Order, Credit Limits, integrations (API keys, webhooks, external integrations), CMS, SEO, languages + currencies, analytics — every module page below documents its public surface, and the live OpenAPI document at `GET /api/v1/_openapi.json` is the runtime contract.
- **Storefront** (Next.js) ships register / login / 2FA / password reset, account area, organization settings (members + addresses + pending invitations), cart, checkout (with credit-limit-aware payment-method visibility), order confirmation + history, RFQ list + detail with the PDP "Request a quote" widget, shopping lists with bulk convert-to-cart / convert-to-RFQ, quick-order CSV importer, and the impersonation banner.
- **Admin panel** (Vite + React) ships Products / Categories / Attributes, Inventory, Organizations, Orders, Invoices, Quote Requests (Claim / Send Quote / Decline), Price Lists / Taxes / Promotions, Delivery + Payment Methods, Credit Limits, Users + Roles with a permissions matrix, Audit Log viewer, Impersonation banner, plus API Keys / Webhooks / Integrations / Analytics / SEO / Languages / CMS modules.

PRs that add or change a module MUST update the relevant page in the same commit range.

## About this site

This is the public documentation of Endora Commerce, published at `https://docs.commerce.endora.software/` in English and Polish: it is built with Docusaurus from the documentation sources kept in the product's own repository — the site's own pages under `docs/`, plus one documentation directory per module, collected at build time — so a page and the code it describes change together.
