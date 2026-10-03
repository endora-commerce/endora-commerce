---
title: newsletter
description: Newsletter na własnej infrastrukturze — lista subskrybentów, tagi, segmenty, jednorazowe kampanie i wieloetapowe automatyzacje ze zgodą zbieraną osobno w każdym kanale
---

# `newsletter`

Wysyłka newslettera na własnej infrastrukturze. Pozwala operatorom budować listę subskrybentów,
dzielić ją na segmenty według **tagów** i **pól niestandardowych** oraz docierać do odbiorców przez
jednorazowe **kampanie** i wieloetapowe **automatyzacje** (liniowe sekwencje kroków „wyślij” i
„czekaj”). Odwiedzający storefront i zalogowani klienci zapisują się na newsletter po wyrażeniu
**zgody (opt-in)**, osobno w każdym kanale sprzedaży; każdy e-mail zawiera działający link do
wypisania się. Treść korzysta z mechanizmu generowania bezpiecznego dla programów pocztowych i z
dyrektyw `{{var}}/{{if}}/{{for}}` znanych z `transactional_emails`
(`@endora-commerce/email-components`). Wysyłka masowa przechodzi przez własnego, konfigurowalnego
**dostawcę wysyłki** modułu (adapter SMTP, który obsługuje Amazon SES SMTP, Mailgun lub dowolny
serwer pośredniczący), niezależnie od wysyłki e-maili transakcyjnych. Cały moduł można **włączać i
wyłączać**, aby nie kolidował z zewnętrzną usługą e-mail marketingu (MailerLite, GetResponse…).

## Pojęcia

- **Subskrybent** — identyfikowany adresem e-mail (tożsamość globalna). Status: `pending` →
  `active` → `unsubscribed` / `deactivated`. Ponowne zapisanie tego samego adresu łączy tagi i pola
  niestandardowe zamiast tworzyć duplikat. Osobna **lista wykluczeń** (wypisanie, odbicie, skarga),
  identyfikowana adresem e-mail, przetrwa usunięcie subskrybenta i ma pierwszeństwo przed każdym
  wyborem odbiorców.
- **Zgoda (opt-in)** — ustawiana dla każdego kanału sprzedaży w `newsletter.opt_in_mode`
  (`single` | `double`). Podwójna zgoda wysyła podpisany link potwierdzający o ograniczonej
  ważności; niepotwierdzeni subskrybenci `pending` wygasają po `newsletter.confirm_ttl_hours`.
- **Tagi i pola niestandardowe** — definiuje je operator; tagi decydują o odbiorcach kampanii i
  uruchamiają automatyzacje, a pola niestandardowe uzupełniają dane subskrybentów (ustawiane przez
  API, panel administracyjny lub formularz zapisu) i służą jako kryteria automatyzacji.
- **Kampania** — jednorazowa wysyłka do odbiorców `all` / ręcznie wybranej grupy `group` / `tag` /
  `tag_list`. Tworzona we wspólnym edytorze e-maili Page Builder (ta sama paleta bloków co e-maile
  transakcyjne): temat, drzewo treści Puck i zmienne; podgląd na przykładowych danych; wysyłka od
  razu albo w zaplanowanym terminie.
- **Automatyzacja** — liniowa sekwencja kroków `send` / `wait N days`, uruchamiana dla odbiorców
  all / tag / tag-list. Kroki wysyłki korzystają z tego samego edytora e-maili. Model kroków
  zaprojektowano tak, by później można było dodać rozgałęzienia warunkowe bez przebudowy.
- **Bloki e-mail** — wielokrotnego użytku fragmenty bezpieczne dla programów pocztowych, edytowane
  tym samym edytorem Puck i wstawiane przez `EmailInsertBlock` tam, gdzie to skonfigurowano.
- **Zmienne** — katalog zmiennych newslettera obejmuje `subscriber.email`, `customFields.*`,
  `unsubscribeUrl`, `webviewUrl`, `channel.id` oraz klucze identyfikacji wizualnej; **Insert
  variable** w panelu działa w temacie i w treści.
- **Dostawca wysyłki** — wybierany i konfigurowany w panelu administracyjnym; hasło SMTP jest
  przechowywane jako ustawienie typu `secret` (AES-256-GCM, na granicy API tylko do zapisu).

## Wysyłka

Wysyłka działa na kolejkach Redis/BullMQ:

- `newsletter.campaign.plan` — wyznacza odbiorców i **atomowo rezerwuje** wiersz
  `newsletter_send_records` dla każdego z nich (`INSERT … ON CONFLICT DO NOTHING`), a potem dodaje
  do kolejki zadanie wysyłki dla każdego nowo zarezerwowanego odbiorcy.
- `newsletter.send` — generuje i wysyła wiadomość do jednego odbiorcy, idempotentnie według
  identyfikatora rekordu wysyłki (używanego jako `messageId` u dostawcy), z ograniczeniem
  przepustowości workera wysyłki (`newsletter.rate_limit_per_second`).
- `newsletter.automation.step` — wykonuje krok; kroki `wait` planują następny krok jako **zadanie
  opóźnione** BullMQ. Przebieg sam się anuluje, gdy subskrybent wypisze się w trakcie sekwencji.

Workery działają w osobnym punkcie wejścia `worker.ts` i wstrzymują się, gdy moduł jest wyłączony.
Producenci tylko dodają zadania do kolejki — nigdy nie wykonują ich od razu — więc przy dwóch lub
więcej workerach żadna wiadomość nie zostanie wysłana dwa razy.

## Zaangażowanie odbiorców

Śledzenie otwarć korzysta z piksela 1×1; śledzenie kliknięć przepisuje linki na podpisane
przekierowania. Liczniki wysłanych / dostarczonych / nieudanych / otwartych / klikniętych dla
każdej kampanii (oraz kliknięcia poszczególnych linków) są sumowane z `newsletter_send_records` i
`newsletter_engagement_events`. Śledzenie można wyłączyć w każdej kampanii.

## Uprawnienia

- `newsletter:read` — podgląd subskrybentów, kampanii, automatyzacji i statystyk.
- `newsletter:write` — zarządzanie subskrybentami, kampaniami, automatyzacjami, blokami i dostawcą
  wysyłki.

## Storefront

Komponent formularza zapisu wielokrotnego użytku (server action, z możliwością przypisania tagu),
strona potwierdzenia podwójnej zgody, strona wypisania (z opcjonalnym powodem) oraz panel na koncie
klienta pokazujący stan subskrypcji i tagi, z przyciskami zapisu i wypisania.

## Schemat

Migracja `083_newsletter_init.ts` tworzy `newsletter_subscribers`, `newsletter_tags`,
`newsletter_subscriber_tags`, `newsletter_custom_fields`, `newsletter_suppressions`,
`newsletter_email_blocks` (z tabelą łączącą z kanałami), `newsletter_campaigns` (z tabelą łączącą z
grupami), `newsletter_send_records`, `newsletter_engagement_events`, `newsletter_automations` i
`newsletter_automation_runs`. Konfiguracja dostawcy wysyłki i tryb zgody są przechowywane w module
**ustawień** (bez osobnej tabeli danych uwierzytelniających).
