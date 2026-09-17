---
title: newsletter
description: Newsletter na własnej infrastrukturze — lista subskrybentów, tagi, segmenty, jednorazowe kampanie i wieloetapowe automatyzacje z opt-in per kanał
---

# `newsletter`

Wysyłka newslettera na własnej infrastrukturze. Pozwala operatorom rozwijać listę
subskrybentów, segmentować ją **tagami** i **polami niestandardowymi** oraz
docierać przez jednorazowe **kampanie** i wieloetapowe **automatyzacje** (liniowe
sekwencje send/wait). Odwiedzający storefront i zalogowani klienci subskrybują z
modelem **opt-in** per Sales Channel; każdy e-mail niesie działający link
wypisania. Treść reużywa renderer bezpieczny dla klientów pocztowych i silnik
dyrektyw `{{var}}/{{if}}/{{for}}` ze stosu `transactional_emails`
(`@endora-commerce/email-components`). Masowa dostawa przechodzi przez własny
konfigurowalny **provider wysyłki** modułu (adapter SMTP docierający do Amazon SES
SMTP, Mailgun lub dowolnego relay), niezależnie od transportu e-maili
transakcyjnych. Cały moduł można **włączać/wyłączać**, aby nigdy nie kolidował z
zewnętrznym ESP (MailerLite, GetResponse, …).

## Pojęcia

- **Subscriber** — kluczowany po e-mailu (globalna tożsamość). Status to `pending` →
  `active` → `unsubscribed` / `deactivated`. Ponowne wysłanie e-maila scala tagi
  i pola niestandardowe zamiast duplikować. Osobna lista **suppression**
  (unsubscribe / bounce / complaint), kluczowana po e-mailu, przeżywa usunięcie i
  nadpisuje wszystkie targetowania.
- **Opt-in** — per Sales Channel przez Settings `newsletter.opt_in_mode`
  (`single` | `double`). Double opt-in wydaje podpisany, ograniczony TTL link
  potwierdzający; niepotwierdzeni subskrybenci `pending` wygasają po
  `newsletter.confirm_ttl_hours`.
- **Tagi i pola niestandardowe** — definiowane przez operatora; tagi napędzają
  targetowanie kampanii i triggery automatyzacji, pola niestandardowe wzbogacają
  subskrybentów (ustawiane przez API, Admin UI lub signup) i zasilają kryteria
  automatyzacji.
- **Campaign** — jednorazowa wysyłka do `all` / ręcznej `group` / `tag` /
  `tag_list`. Autorowana we wspólnym email Page Builderze (ta sama paleta co
  e-maile transakcyjne) z subject + drzewem treści Puck + zmiennymi; podgląd ze
  sample data; wysyłka teraz lub zaplanowana.
- **Automation** — liniowa sekwencja `send` / `wait N days` triggerowana przez
  all/tag/tag-list. Kroki send używają tego samego email Page Buildera. Model kroków
  jest zaprojektowany tak, by później rozszerzyć o warunkowe rozgałęzienie bez
  przebudowy.
- **Email blocks** — wielokrotnie używane fragmenty bezpieczne dla e-maili
  edytowane tym samym edytorem Puck i osadzalne przez `EmailInsertBlock` tam, gdzie
  skonfigurowano.
- **Variables** — katalog newslettera obejmuje `subscriber.email`,
  `customFields.*`, `unsubscribeUrl`, `webviewUrl`, `channel.id` plus klucze
  brandingu; admin **Insert variable** działa na subject i treści.
- **Provider** — wybierany i konfigurowany w Admin UI; hasło SMTP jest
  przechowywane jako Settings `secret` (AES-256-GCM, write-only na granicy).

## Dostawa (Zasada X)

Dispatch jest oparty na kolejce Redis/BullMQ:

- `newsletter.campaign.plan` — rozwiązuje audience i **atomowo claimuje**
  wiersz `newsletter_send_records` per odbiorca (`INSERT … ON CONFLICT DO
  NOTHING`), potem enqueue'uje job send dla każdego świeżo-claimowanego odbiorcy.
- `newsletter.send` — renderuje + dispatchuje jednego odbiorcę, idempotentnie na id
  send-record (używane jako provider `messageId`), throttled przez rate limiter
  send-workera (`newsletter.rate_limit_per_second`).
- `newsletter.automation.step` — wykonuje krok; kroki `wait` planują następny
  krok jako **delayed job** BullMQ. Run samo-anuluje się, gdy subskrybent
  wypisze się w trakcie sekwencji.

Workery działają pod separowalnym entrypointem `worker.ts` i pauzują, gdy moduł
jest wyłączony. Producenci tylko enqueue'ują — nigdy nie wykonują inline — więc
N≥2 workerów nigdy nie double-send'uje.

## Engagement

Open tracking używa piksela 1×1; click tracking przepisuje linki przez podpisany
redirect. Per-kampania liczniki sent / delivered / failed / opened / clicked
(plus per-link clicks) są agregowane z `newsletter_send_records` i
`newsletter_engagement_events`. Tracking można wyłączyć per kampania.

## Uprawnienia

- `newsletter:read` — podgląd subskrybentów, kampanii, automatyzacji, statystyk.
- `newsletter:write` — zarządzanie subskrybentami, kampaniami, automatyzacjami,
  blokami i providerem wysyłki.

## Storefront

Reużywalny komponent signup (server action, tag-attachable), landing double-opt-in,
strona wypisania (opcjonalny powód) oraz panel konta pokazujący status subskrypcji
+ tagi z akcjami subscribe/unsubscribe.

## Schema

Migracja `083_newsletter_init.ts` tworzy `newsletter_subscribers`,
`newsletter_tags`, `newsletter_subscriber_tags`, `newsletter_custom_fields`,
`newsletter_suppressions`, `newsletter_email_blocks`(+ channel bridge),
`newsletter_campaigns`(+ group bridge), `newsletter_send_records`,
`newsletter_engagement_events`, `newsletter_automations` i
`newsletter_automation_runs`. Konfiguracja providera + tryb opt-in żyją w
module **Settings** (brak dedykowanej tabeli credentials).
