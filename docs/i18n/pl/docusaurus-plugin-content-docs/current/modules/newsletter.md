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
  API, panel administracyjny lub formularz zapisu) i służą jako kryteria automatyzacji. Wartość
  pola niestandardowego jest zapisywana tylko wtedy, gdy jej klucz jest zdefiniowanym polem **i**
  wartość pasuje do typu pola (tak/nie → `true`/`false`, liczba → skończona liczba, data →
  istniejąca data `YYYY-MM-DD`, tekst → najwyżej 500 znaków; `null` czyści wartość); każda inna
  wartość jest pomijana, a żądanie nie jest odrzucane.
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
- **Identyfikacja wizualna** — logo i kolor akcentu pochodzą z kanału sprzedaży kampanii lub
  automatyzacji. Kampania albo automatyzacja utworzona bez kanału sprzedaży jest podglądana
  i wysyłana z identyfikacją wizualną **domyślnego** kanału sprzedaży.
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

E-maile kampanii mogą zawierać śledzenie otwarć i kliknięć, dodawane w chwili wysyłki wiadomości
do każdego odbiorcy. Oba rodzaje śledzenia są **wyłączone**, dopóki operator ich nie włączy
(zobacz ustawienia poniżej); instancja bez zmienionych ustawień wysyła kampanie bez śledzenia.

- **Otwarcia** — przed końcem treści wiadomości dodawany jest niewidoczny obrazek 1×1,
  `GET /api/v1/newsletter/open.gif?token=…`. Jego wczytanie zapisuje otwarcie w rekordzie wysyłki
  odbiorcy.
- **Kliknięcia** — każdy bezwzględny link `http(s)` jest zamieniany na
  `GET /api/v1/newsletter/click?token=…&u=<destination>`. Token jest podpisany i powiązany z
  rekordem wysyłki, z identyfikatorem linku numerowanym w kolejności występowania w dokumencie
  (`link-1`, `link-2`, …) oraz z adresem docelowym, więc przekierowanie prowadzi wyłącznie do
  linku, z którym e-mail został wysłany. Token, którego nie da się zweryfikować, daje odpowiedź
  `410`; adres docelowy niezgodny z tokenem prowadzi na stronę główną storefrontu. Linki
  `mailto:` i `tel:`, kotwice w obrębie strony, linki względne oraz własne linki modułu
  (wypisanie, potwierdzenie) pozostają bez zmian. Część tekstowa wiadomości jest wysyłana bez
  zmian.

Oba adresy są budowane na publicznym bazowym adresie API, z którego korzysta link do wypisania,
a oba tokeny są ważne przez rok. Kliknięcie śledzonego linku liczy się także jako otwarcie, więc
odbiorca, którego program pocztowy blokuje obrazki, zostaje policzony, gdy kliknie link.

Dwa ustawienia w grupie **Newsletter** włączają i wyłączają oba rodzaje śledzenia niezależnie od
siebie. Oba są domyślnie **wyłączone**, więc kampania jest śledzona dopiero wtedy, gdy operator
włączy je na ekranie ustawień. Każde można ustawić osobno dla każdego kanału sprzedaży (kampania
bez kanału sprzedaży korzysta z wartości domyślnego kanału sprzedaży):

| Ustawienie | Gdy wyłączone (domyślnie) |
| --- | --- |
| `newsletter.tracking.opens_enabled` | obrazek nie jest dodawany, a otwarcia nie są liczone |
| `newsletter.tracking.clicks_enabled` | linki prowadzą prosto do celu, a kliknięcia nie są liczone |

Kampania utworzona przez API z `trackingEnabled: false` jest wysyłana bez obu rodzajów śledzenia.
E-maile automatyzacji nie są śledzone.

Liczniki wysłanych / dostarczonych / nieudanych / otwartych / klikniętych dla każdej kampanii
(oraz kliknięcia poszczególnych linków) są sumowane z `newsletter_send_records` i
`newsletter_engagement_events`. Liczba otwarć jest przybliżona: program pocztowy blokujący obrazki
nie zgłasza żadnego otwarcia, a program, który wczytuje obrazki za czytelnika, zgłasza otwarcie,
które mogło nie nastąpić.

## Uprawnienia

- `newsletter:read` — podgląd subskrybentów, kampanii, automatyzacji i statystyk.
- `newsletter:write` — zarządzanie subskrybentami, kampaniami, automatyzacjami, blokami i dostawcą
  wysyłki.

## Storefront

Komponent formularza zapisu wielokrotnego użytku (server action, z możliwością przypisania tagu),
strona potwierdzenia podwójnej zgody, strona wypisania (z opcjonalnym powodem) oraz panel na koncie
klienta pokazujący stan subskrypcji i tagi, z przyciskami zapisu i wypisania.

### Blok zapisu w Page Builderze

Moduł deklaruje blok Page Buildera `newsletter.Signup` (sekcja palety
*Formularze*, etykieta **Zapis do newslettera**), dzięki któremu redaktor może
umieścić formularz zapisu na dowolnej stronie CMS:

| Opcja | Znaczenie |
| --- | --- |
| Nagłówek, tekst | Opcjonalny nagłówek (z poziomem) i tekst sformatowany nad formularzem. |
| Etykieta pola e-mail, tekst zastępczy, etykieta przycisku | Własne teksty formularza. |
| Tematy | Do 12 pól wyboru, każde z etykietą i **tagiem** newslettera; zaznaczone trafiają do subskrybenta jako tagi. W panelu administracyjnym tag wybiera się po nazwie z listy istniejących tagów newslettera, a blok zapisuje jego kod. Zapisany kod, którego nie ma na liście, pozostaje wybrany; bez listy (brak uprawnienia `newsletter:read`, wyłączony moduł) kod wpisuje się jako tekst. **Topics required** wymaga zaznaczenia co najmniej jednego. Temat z nieprawidłowym kodem tagu nie jest pokazywany. |
| Atrybuty subskrybenta | Do 10 **pól niestandardowych** newslettera, pokazywanych po polu e-mail, a przed tematami. W panelu administracyjnym każde wybiera się spośród istniejących pól niestandardowych, co zapisuje też jego typ i etykietę. Pole tak/nie jest polem wyboru; pole tekstowe, liczbowe lub daty — odpowiednim polem do wpisania (tekst ma najwyżej 500 znaków). Każde ma opcjonalną **etykietę** (inaczej etykietę samego pola), **podpowiedź w polu** (nie dla pola tak/nie) i przełącznik **Wymagane**: wymagane pole wyboru trzeba zaznaczyć, każde inne wymagane pole — wypełnić. |
| Etykieta zgody | Tekst pola zgody, które jest zawsze pokazywane i zawsze wymagane. To tekst sformatowany w jednej linii, więc może zawierać link do polityki prywatności. |
| Układ | W linii (pole i przycisk obok siebie) albo w ramce. |
| Położenie przycisku, kształt pola | **Obok pola** (domyślnie) albo **Wewnątrz pola**: pole e-mail i przycisk mają wspólną ramkę, **Zaokrągloną** (domyślnie) albo w kształcie **Pigułki**. |
| Kolumny tematów | Tematy w siatce 1–4 kolumn; pozostawione puste, układają się w jednym zawijanym rzędzie. |
| Ukryj etykietę pola e-mail | Ukrywa wizualnie etykietę pola e-mail; pozostaje ona etykietą pola, więc czytniki ekranu nadal ją odczytują. Użyj tekstu zastępczego, aby widzący odwiedzający wiedzieli, co wpisać. |
| Komunikaty | Teksty pokazywane po zapisie: oczekiwanie na potwierdzenie, zapisano oraz odmowy (brak zgody, nieprawidłowy e-mail, nie wybrano tematu, usługa niedostępna oraz — przy atrybutach subskrybenta — brak wymaganego pola, który pozostawiony pusty korzysta z przetłumaczonego tekstu sklepu). |

Każdy tekst można przetłumaczyć akcją **Przetłumacz** w Page Builderze. Na
najwyższym poziomie strony blok ma też ustawienia sekcji (kotwicę, schemat
kolorów, tło, odstępy, szerokość).

**Droga zapisu.** Blok to zwykły formularz HTML wysyłany do własnego handlera
storefrontu, `POST /newsletter/subscribe`
(`storefront/app/newsletter/subscribe/route.ts`), więc działa bez JavaScriptu.
Handler:

- odpowiada `404`, dopóki moduł newslettera nie jest obecny;
- sprawdza adres e-mail tą samą regułą co backend, wymaga `consent=on`,
  zachowuje najwyżej 12 kodów tematów zgodnych z `^[a-z0-9_-]{1,64}$` i pomija
  pozostałe, a jako `returnTo` przyjmuje tylko ścieżkę w tym samym źródle
  (wszystko inne wraca na `/`);
- odczytuje atrybuty subskrybenta opisane przez blok (najwyżej 10), zamienia
  każdą wartość na jej typ — zaznaczone pole wyboru to `true`, niezaznaczone
  `false`, liczba, gdy jest liczbą, data, gdy ma postać `YYYY-MM-DD`, tekst
  przycięty, najwyżej 500 znaków — i odrzuca zapis z `reason=fields`, gdy brakuje
  wymaganego;
- zapisuje przez istniejący `POST /api/v1/newsletter/subscribe` w kanale
  sprzedaży żądania, z zaznaczonymi tematami jako `tags`, atrybutami jako
  `customFields` i `source: 'cms-block'`;
- bez JavaScriptu przekierowuje (`303`) z powrotem na stronę z
  `?newsletter=pending|active|error&reason=consent|email|topics|fields|unavailable`
  i kotwicą sekcji jako fragmentem, a blok pokazuje odpowiedni komunikat;
- z JavaScriptem blok wysyła formularz z `Accept: application/json` i dostaje
  `{status: 'pending' | 'active'}` (200) albo `{error: …}` (400); komunikat
  pojawia się na miejscu, a wpisany adres zostaje.

To, czy odpowiedzią jest `pending` czy `active`, zależy od trybu potwierdzania
zapisu w kanale. Subskrypcja jest zapisywana jak każda inna: ustawiane jest
`consentAt`, wpis audytu `newsletter_subscribe` zawiera `source: 'cms-block'`,
więc te zapisy można odróżnić od pozostałych, a kod tematu, który nie pasuje do
żadnego istniejącego tagu, jest pomijany — storefront nie tworzy tagów. Moduł
ponownie sprawdza każdą wartość atrybutu względem własnych definicji pól
niestandardowych i zachowuje tylko wartości o pasującym typie (zob. *Tagi i pola
niestandardowe*).

**Rząd pól wyboru z tematami.** Aby pokazać tematy jako rząd pól wyboru — na
przykład w stopce strony — najpierw utwórz tagi (**Newsletter → Tagi i pola**), a potem
w bloku dodaj po jednym temacie na tag, nadaj mu etykietę widoczną dla
odwiedzających i wybierz jego tag. Pozostaw **Kolumny tematów** puste, aby
tematy układały się w jednym zawijanym rzędzie, albo ustaw 2–4, aby utworzyć
siatkę; włącz **Topics required**, jeśli zapis bez tematu ma być odrzucany.

Gdy moduł jest wyłączony, blok nie jest oferowany w palecie, zapisany blok nic
nie wyświetla, a handler odpowiada `404`.

`newsletter.Signup` to własny newsletter platformy. Moduł CMS zachowuje osobny
formularz **Zapis do newslettera**, `cms.NewsletterSignup`, który wysyła dane do
dowolnego zewnętrznego endpointu, dla usługi newslettera spoza platformy.

## Schemat

Migracja `20260629T200954_newsletter_init.ts` tworzy `newsletter_subscribers`, `newsletter_tags`,
`newsletter_subscriber_tags`, `newsletter_custom_fields`, `newsletter_suppressions`,
`newsletter_email_blocks` (z tabelą łączącą z kanałami), `newsletter_campaigns` (z tabelą łączącą z
grupami), `newsletter_send_records`, `newsletter_engagement_events`, `newsletter_automations` i
`newsletter_automation_runs`. Konfiguracja dostawcy wysyłki i tryb zgody są przechowywane w module
**ustawień** (bez osobnej tabeli danych uwierzytelniających).
