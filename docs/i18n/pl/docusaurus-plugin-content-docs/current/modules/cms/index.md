---
title: CMS
sidebar_position: 1
description: Tworzenie treści w Page Builderze — strony, bloki, szablony, hooki — osobno dla kanałów i języków
---

# CMS

Moduł CMS to redakcyjna część platformy. Odpowiada za cztery encje tworzone w edytorze **Page
Builder** (przeciągnij i upuść) i udostępniane w storefroncie z pełnym zawężeniem do kanału
sprzedaży i języka.

| Encja      | Identyfikator        | Cykl życia                            | Gdzie jest osadzana                                   |
| ----------- | ----------------- | ------------------------------------ | --------------------------------------------- |
| **Strona**    | `slug` (w obrębie kanału) | `draft → published → archived`       | Adres w storefroncie                         |
| **Blok**   | `code` (w obrębie kanału) | flaga `active`                        | Strony (`InsertBlock`) i hooki (przypięcie)  |
| **Szablon**| `code` (w obrębie kanału) | zawsze widoczny (bez flagi)             | Wzorce stron i bloków (**Save as template** / **Apply template**). Dawne osadzenia `InsertTemplate` nadal działają. |
| **Hook**    | `code` (globalny)      | flaga `active`, wpisy początkowe chronione przez system | Układy storefrontu (`<Hook code="..." />`)    |

## Encje i graf odwołań

Graf encji w czasie działania:

```
       Hook ──── attachment ────┐
                                ▼
                            Block ─── InsertBlock ───┐
                                                     ▼
                            Template (blueprint) ──> Page / Block canvas (Save as / Apply template)
                            Template ── InsertTemplate (legacy) ──> Page (slug-routed)
```

Szablony treści (`cms_templates`) to wielokrotnego użytku układy Page Buildera (Save as template /
Apply template). Szablony e-maili i faktur mają własne listy w panelu i własne miejsce
przechowywania. Osadzanie przez `InsertTemplate` usunięto z palety komponentów; istniejące drzewa
nadal się wyświetlają.

Ochrona odwołań działa przy każdym usuwaniu:

- **Bloku**, do którego odwołuje się strona, szablon albo przypięcie do hooka, nie można usunąć (HTTP
  `409 CMS_REFERENCED`).
- **Szablonu**, do którego odwołuje się strona albo blok, nie można usunąć.
- **Hooka** z flagą `is_system=true` nie można usunąć (`409 CMS_HOOK_SYSTEM_PROTECTED`); hooki
  utworzone przez administratora można usuwać.

Każde wyszukiwanie odwołań to przejście JSONB po strukturze `content` encji (`page→block`,
`page→template`, `block→template`, `template→block`) oraz sprawdzenie klucza obcego w
`cms_hook_block_attachments` dla `hook→block`.

Tę samą zawartość JSONB `content` przeszukuje też **rejestr odwołań biblioteki mediów** — usunięcie
pliku osadzonego we właściwościach (`props`) komponentu CMS jest odrzucane w ten sam sposób.

## Tworzenie treści w Page Builderze

Page Builder jest zbudowany na **Puck** (`@puckeditor/core`). Jego bloki są
deklarowane w manifestach modułów, do których należą, a wyświetla je
`@endora-commerce/cms-components` — zarówno w edytorze w panelu, jak i w
storefroncie, więc podgląd odpowiada opublikowanej stronie. Kolory, czcionki,
skala typografii, przyciski i odstępy pochodzą z ustawień marki, edytowanych
raz na ekranie [Marka](./brand.md).

### Bloki

Strona to ciąg **sekcji**: `cms.Section` to jedyny blok z
[ustawieniami sekcji](#ustawienia-sekcji) opisanymi niżej, a mieści dowolne
inne bloki. Funkcja 163 (Page Builder dla stron marketingowych) dodała,
przebudowała i usunęła część bloków; ostatnia kolumna mówi, co się zmieniło.

| Blok | Etykieta w palecie | Czym jest i co się zmieniło |
| --- | --- | --- |
| `cms.Section` | Sekcja | **Nowy.** Pas strony z własną kotwicą, schematem kolorów, tłem, odstępami, szerokością, położeniem treści i animacją wejścia, mieszczący dowolne bloki. Stoi tylko na najwyższym poziomie strony albo w grupie sekcji. |
| `cms.SectionGroup` | Grupa sekcji | **Nowy.** Mieści sekcje i maluje za nimi wszystkimi jeden schemat kolorów, tło i tło dekoracyjne, bez szwów między nimi; opcjonalny odstęp nad i pod oraz kotwica. Stoi tylko na najwyższym poziomie strony. Zobacz [Grupy sekcji](#grupy-sekcji). |
| `cms.Row` | Wiersz | Kontener układu z kolumnami. Bez zmian. |
| `cms.Column` | Kolumna | Kolumna wewnątrz Wiersza. **Rozszerzona** o **Rozmieść bloki w pionie** (od góry, czyli domyślnie, do środka, do dołu, równe odstępy albo ostatni blok na dole); blok umieszczony w kolumnie może mieć inną **Kolejność w kolumnie** dla każdego progu, a sama kolumna inną **Kolejność w wierszu**: zob. [Kolumny: rozmieszczenie i kolejność](#kolumny-rozmieszczenie-i-kolejność). Kolumna może też zajmować kilka wierszy swojego Wiersza i zaczynać się w wybranej kolumnie lub wierszu dla każdego progu: zob. [Kolumny: miejsce w siatce wiersza](#kolumny-miejsce-w-siatce-wiersza). |
| `cms.Heading` | Nagłówek | **Przebudowany.** Tekst to tekst sformatowany w jednej linii (pogrubienie, kursywa, link, trzy style wyróżnienia, ikona z katalogu ikon: zob. [Ikony w nagłówkach i podpisach](#ikony-w-nagłówkach-i-podpisach)). Poziom semantyczny (`h1`–`h6` albo akapit) wybiera się niezależnie od rozmiaru wizualnego, który jest tokenem skali typografii. Czcionka, rozmiar, grubość, styl i interlinia pozostają dostępne jako nadpisania **Custom** w grupie „Advanced”. |
| `cms.Text` | Tekst | Tekst z ustawieniami typografii; jako wartości domyślnych używa tokenów marki. **Rozszerzony** o maksymalną szerokość tekstu dla każdego progu (wąska, średnia, szeroka albo własna w px; domyślnie brak), która podąża za wyrównaniem tekstu. |
| `cms.RichContent` | Treść sformatowana | Tekst sformatowany TipTap. **Rozszerzony** o zwijany tekst „czytaj więcej”, listę z ptaszkami, linki wyświetlane jako przyciski, kotwice nagłówków, nagłówki ukryte wizualnie, trzy style wyróżnienia i maksymalną szerokość tekstu dla każdego progu. Jego nagłówki idą za skalą typografii marki, gdy jest ustawiona (zob. [Nagłówki w tekście sformatowanym i skala typografii](#nagłówki-w-tekście-sformatowanym-i-skala-typografii)). Obraz w tekście ma **Szerokość** w px lub %, **Wyrównanie** (do lewej, do środka, do prawej) i opcję **W linii tekstu**, która umieszcza go w zdaniu (logo, mała grupa awatarów); to samo dotyczy tekstu sformatowanego w pozostałych blokach. W panelu administracyjnym **Źródło obrazu** pozwala wybrać obraz z **Biblioteki zasobów** (jego tekst alternatywny trafia do pola, gdy zasób go ma, a pole jest jeszcze puste) albo podać **Adres URL**. |
| `cms.Button` | Przycisk | **Przebudowany.** Jeden przycisk opisany stylem (`primary`, `secondary`, `light`, `dark`), wypełnieniem (`solid`, `outline`, `text`), rozmiarem, opcjonalną ikoną (przed etykietą, po niej albo sama ikona), nadpisaniami kolorów i linkiem. Dawny wariant `ghost` to wypełnienie `text`. |
| `cms.Image` | Obraz | **Rozszerzony.** **Obraz na telefon** wyświetlany poniżej szerokości tabletu, **Proporcje** dla każdego progu (karta **Responsive**; gotowa wartość albo własne `szer.:wys.`, domyślnie własne proporcje obrazu), **Nakładka** (jednolita lub gradient, z kierunkiem i intensywnością) oraz opcjonalny **Podpis** pod obrazem albo obok niego — obraz ze zdaniem obok, na przykład małą grupą awatarów. **Pełna szerokość** to dotychczasowa opcja Szerokość; w sekcji o szerokości **Bleed** obraz sięga krawędzi okna. Obraz ładuje się leniwie; z ustawionymi proporcjami jego miejsce jest zarezerwowane przed wczytaniem. Bez tych opcji wygląda jak dotąd. |
| `cms.Icons`, `cms.Social`, `cms.Spacer` | Ikony, Social media, Odstęp / Separator | Bez zmian. |
| `cms.Hero` | Hero / Baner CTA | **Przebudowany.** Media (jednolity kolor, gradient, obraz z wersją mobilną albo wideo z własnego serwera z kadrem zastępczym i **Proporcjami wideo** dla każdego progu, gdy wideo jest nad tekstem, domyślnie 16:9) za tekstem lub nad nim; nadtytuł, tytuł, podtytuł i hasło, każde z własnym poziomem i rozmiarem; tekst sformatowany; do sześciu przycisków; dowód społeczny (obraz i podpis); **Przyciemnienie (nakładka na media w tle)**, minimalna wysokość, wyrównanie i opcjonalna animacja wejścia; **Typ** przyciemnienia to brak, jednolite albo gradientowe, a widoczne są tylko ustawienia, których ten typ używa (siła dla jednolitego i gradientowego, kierunek dla gradientowego). **Elementy: kolejność i odstępy** ustawia nadtytuł, tytuł, podtytuł, hasło, tekst, przyciski i dowód społeczny w dowolnej kolejności (niewymienione idą dalej w kolejności domyślnej), a każdy wymieniony element może mieć **Odstęp po elemencie** (rozmiar odstępu albo **Własny** w px); przy wartości **Domyślny** element zachowuje **Odstęp między elementami**, a gdy nie jest ustawiony — domyślne odstępy. **Szerokość mediów: Pełna szerokość okna** pozwala obrazowi lub wideo sięgać krawędzi okna, a tekst zostaje w banerze. Wersją mobilną wideo jest wideo z biblioteki albo, przy źródle URL, **Adres URL wideo na urządzenia mobilne**. **Źródło obrazu zastępczego** ustala, skąd pochodzą oba kadry: z **Biblioteki zasobów** (**Obraz zastępczy (plakat)**, **Obraz zastępczy na telefon (plakat)**) albo z **Adresu URL** (**Adres URL obrazu zastępczego**, **Adres URL obrazu zastępczego na telefon**); kadr na telefon jest widoczny, zanim wideo na telefon ruszy, więc wideo o innych proporcjach nie jest pokazywane przycięte. Tytuł ma **Grubość tytułu** i **Maksymalną szerokość tytułu** dla każdego progu: zob. [Nagłówki: grubość i szerokość](#nagłówki-grubość-i-szerokość). |
| `cms.MediaText` | Media i tekst | **Nowy.** Obraz albo wideo (z Biblioteki zasobów albo, przy **Źródle wideo: Adres URL**, spod adresu, każde z opcjonalnym wideo na urządzenia mobilne pokazywanym poniżej szerokości tabletu, oraz z **Proporcjami wideo** dla każdego progu, domyślnie 16:9) obok tekstu: strona, kolejność na telefonie, podział kolumn, wyrównanie pionowe, elementy z ikonami, przyciski, przypis oraz powtarzane wiersze, które mogą zmieniać stronę na przemian. Wideo przyjmuje opcjonalny **Obraz zastępczy na telefon (plakat)** albo **Adres URL obrazu zastępczego na telefon** dla wideo na telefon. **Rozmiar tytułu elementu** (rozmiar ze skali typografii albo **Własny (px)**, dla każdego progu) i **Grubość tytułu elementu** (300–800) zmieniają tytuł każdego elementu; pozostawione na **Domyślny**, tytuły mają jak dotąd 16 px i są półgrube. |
| `cms.BackgroundPanel` | Panel z obrazem w tle | **Nowy.** Obraz z panelem tekstu po jednej stronie. Aby sięgał od krawędzi do krawędzi, umieść go w sekcji o szerokości **Bleed** albo **Full**. **Przezroczyste pole tekstu** (domyślnie wyłączone) zostawia panel tekstu bez tła schematu, więc za tekstem widać obraz; dobierz schemat tak, by tekst był czytelny na obrazie. |
| `cms.CtaCard` | Karta wezwania do działania | **Nowy.** Wezwanie do działania w ramce z własnym schematem kolorów, z listą, przyciskami, opcjonalnym obrazem i dekoracyjnym tłem marki. |
| `cms.Statement` | Hasło | **Nowy.** Duże hasło lub cytat, opcjonalnie na obrazie wypełniającym blok, z opcjonalnym pojawianiem się słowo po słowie i maksymalną szerokością tekstu dla każdego progu. Sekcja o szerokości **Bleed** rozciąga je od krawędzi do krawędzi. |
| `cms.LinkList` | Lista odnośników | **Nowy.** Wiersze z tytułem, opisem i przyciskiem, z opcjonalną linią oddzielającą. |
| `cms.FeatureList` | Lista funkcji | **Przebudowany.** Liczba kolumn dla każdego progu, wgrywane ikony SVG przyjmujące kolor tekstu, sformatowany tekst elementów, opcjonalny obraz pod siatką. |
| `cms.Stats` | Statystyki | **Przebudowany.** Kluczowe liczby z opcjonalnym nagłówkiem i obrazem. |
| `cms.Testimonial` | Opinia | **Przebudowany.** Dochodzi obraz i układ z tekstem na obrazie; domyślny pozostaje układ karty. |
| `cms.Video` | Wideo | **Rozszerzony.** **Źródło: Osadzenie** (YouTube, Vimeo albo adres strony, jak dotąd: **Adres URL wideo** i **Dostawca**) lub **Plik wideo**. Dla pliku **Źródło pliku** ustala, skąd pochodzi wideo i jego opcjonalna wersja na telefon (pokazywana poniżej szerokości tabletu): z **Biblioteki zasobów** (**Plik wideo**, **Plik wideo na telefon**) albo z **Adresu URL** (**Adres URL wideo**, **Adres URL wideo na telefon**); **Źródło obrazu zastępczego** robi to samo dla **Obrazu zastępczego (plakatu)** i **Obrazu zastępczego na telefon (plakatu)** albo **Adresu URL obrazu zastępczego** i **Adresu URL obrazu zastępczego na telefon**. Widoczne są tylko pola wybranych źródeł. Wideo zapisane, zanim źródła istniały, otwiera się na źródle, które wynika z jego wartości — adres URL bez pliku z biblioteki to źródło URL — i odtwarza się jak dotąd: bez wybranego źródła plik lub obraz z biblioteki wygrywa z adresem URL. **Proporcje** przyjmują każdą gotową wartość i własne `szer.:wys.`, dla każdego progu (karta **Responsive**). Plik nie pobiera niczego, dopóki nie zostanie odtworzony; przy **Odtwarzaj automatycznie** gra bez dźwięku, tylko gdy jest widoczny, i nigdy dla odwiedzającego, który woli ograniczony ruch; w przeciwnym razie odwiedzający uruchamia go przyciskami sterowania. **Zaokrąglone narożniki** (brak, małe, średnie, duże) zaokrąglają ramkę odtwarzacza; domyślne, średnie, to dotychczasowe 8 px. Plik odtwarzany automatycznie zawsze jest wyciszony, więc **Wycisz** jest dostępne tylko dla pliku, który nie odtwarza się sam. |
| `cms.LogoStrip`, `cms.Map`, `cms.SimpleTable` | Pasek logo, Mapa, Tabela | Bez zmian. |
| `cms.AnnouncementBar` | Pasek ogłoszeń | Bez zmian. |
| `cms.ContentSlider` | Karuzela | **Przebudowany** w jedną karuzelę: nagłówek (tytuł, wstęp, przycisk), liczba slajdów w widoku dla każdego progu (1–8, co 0,25), efekt przesuwania lub przenikania, położenie strzałek dla każdego progu, styl, kształt, rozmiar i kolor strzałek, kropki, wyjście poza krawędź do brzegu okna, opcjonalne automatyczne przewijanie. Te same elementy można ułożyć w siatkę z liczbą kolumn dla każdego progu, a opcjonalny pasek filtrów pokazuje tylko elementy z jednym tagiem. Liczba slajdów w widoku jest ustalana w CSS, więc serwer i przeglądarka wyświetlają ten sam układ. Zobacz [Karuzele: sterowanie, siatka i filtr](#karuzele-sterowanie-siatka-i-filtr). |
| `cms.CarouselImage`, `cms.CarouselSplit`, `cms.LinkTile`, `cms.DownloadTile` | Obraz karuzeli, Slajd z mediami i tekstem, Kafelek z linkiem, Kafelek do pobrania | **Nowe** elementy karuzeli, dostępne tylko w karuzeli. Każdy element, a także slajd z dowolną treścią, ma opcjonalne tagi dla filtra karuzeli. Podpis obrazu karuzeli umieszczony na obrazie może leżeć na przyciemnieniu (gradient od jego krawędzi albo równomierne przyciemnienie). Proporcje obrazu kafelka z linkiem mogą być inne dla każdego progu. Obraz karuzeli ma **Obraz – zaokrąglone narożniki** (a jego podpis **Podpis – zaokrąglone narożniki**), kafelek z linkiem — **Zaokrąglone narożniki** (brak, małe, średnie, duże; domyślnie średnie, 8 px). Podpis obrazu karuzeli oraz tytuł i etykieta kafelka z linkiem mają rozmiar dla każdego progu i czcionkę; etykieta kafelka z linkiem to link tekstowy ze strzałką, przycisk albo nic. Kafelek do pobrania to jeden link pobierania pliku z biblioteki zasobów; gdy pliku już nie ma, klient nie widzi nic, a podgląd pokazuje ostrzeżenie. |
| `cms.Tabs`, `cms.Accordion` | Zakładki, Akordeon | **Przebudowane.** Każdy panel zawiera bloki zamiast jednego tekstu HTML, każdy panel jest w HTML wyświetlanym przez serwer, a obsługa klawiatury jest zgodna ze wzorcami WAI-ARIA. Zakładki zyskały animowaną zmianę panelu (przenikanie albo przesunięcie) i wygląd paska kart: tło i obramowanie paska (kapsuła wokół pigułek), kolory aktywnej i pozostałych kart, kolor pozostałych kart po najechaniu, **Rozmiar kart** dla każdego progu (mały, średni albo duży; bez ustawienia średni) oraz **Odstęp pod paskiem kart** (rozmiar odstępu albo **Własny** w px, dla każdego progu; bez ustawienia 12 px). Panel w kolumnach to wstawiony do niego Wiersz: zob. [Zakładki: panel w kolumnach](#zakładki-panel-w-kolumnach). **Zakładki, które się nie mieszczą** albo zawijają się do kolejnych wierszy (domyślnie), albo zostają w jednym wierszu przewijanym w bok wewnątrz bloku, z przyciąganiem do karty; sama strona nigdy nie przewija się w bok, a klawiatura działa tak samo w obu przypadkach. Tytuły elementów akordeonu mogą być nagłówkami (H2–H6, przycisk wewnątrz nagłówka) z rozmiarem ze skali typografii; domyślnie nie są nagłówkami i wyglądają jak dotąd. |
| `cms.NewsletterSignup` | Zewnętrzny formularz newslettera | Zachowany jako formularz wysyłany do **dowolnego zewnętrznego adresu** (`actionUrl`). Dostał opcjonalne pole zgody. Własny zapis do newslettera platformy to blok `newsletter.Signup` opisany niżej. |
| `cms.ContactFormEmbed`, `cms.RawHtml`, `cms.RawJs`, `cms.InsertBlock` | Formularz kontaktowy, Surowy HTML, Surowy JS, Wstaw blok | Bez zmian. `InsertBlock` osadza blok według `code`; sekcja w osadzeniu umieszczonym na najwyższym poziomie strony wyświetla się jako sekcja. |
| `cms.InsertTemplate` | Wstaw szablon | Dawny komponent: zachowany dla istniejących drzew i **nie** ma go w palecie. Zamiast niego używaj Save as / Apply template. |
| ~~`cms.ImageSlider`~~ | — | **Usunięty.** Używaj karuzeli z elementami **Obraz karuzeli**, które mają wszystkie opcje podpisu dawnego slidera obrazów. |

Bloki innych modułów pojawiają się w tej samej palecie, dopóki ich moduł jest
obecny:

| Blok | Moduł | Co się zmieniło |
| --- | --- | --- |
| `blog.LatestPosts` | `blog` | **Nowy.** Najnowsze opublikowane wpisy kanału jako karuzela lub siatka. |
| `newsletter.Signup` | `newsletter` | **Nowy.** Zapisuje przez moduł newslettera, z opcjonalnymi tematami i wymaganym polem zgody; działa bez JavaScriptu. |
| `catalog.ProductGrid`, `catalog.ProductSlider` | `catalog` | **Przebudowane.** Nagłówek, wariant karty (w tym karta `showcase` z krótkim opisem), etykieta linku „więcej” i przycisk pod produktami; slider przejmuje opcje karuzeli. |

**Pusta lista niczego nie pokazuje.** Siatka produktów, slider produktów, siatka
kategorii, lista kategorii albo blok najnowszych wpisów, który nie ma nic do pokazania
(żadnego produktu w kategorii, jeszcze żadnego wpisu), nie zostawia w storefroncie
śladu: ani pola, ani nagłówka, ani zdania. W edytorze podgląd nadal mówi, dlaczego
jest pusty.

### Treść zapisana przed zmianą kształtu bloku

Przebudowany blok zachowuje wszystkie swoje opcje: test zgodności opcji
(`packages/cms-components/src/components/option-parity.test.ts`) przypisuje
każdemu polu, które blok miał przed przebudową, jego nowy odpowiednik. Zapisana
treść nie jest migrowana w bazie danych i nie musi być:

- **Przebudowany blok wyświetla zapisaną treść tak jak wcześniej.** Każdy
  przebudowany blok ma funkcję przekształcającą jego dawne właściwości
  (`heroFromLegacy`, `headingFromLegacy`, `buttonFromLegacy`,
  `contentSliderFromLegacy` itd.), uruchamianą przy wyświetlaniu. Gdy redaktor
  otworzy stronę, edytor przekształca blok do nowej postaci, a następny zapis ją
  utrwala. Panel zakładek lub akordeonu zapisany jako HTML wyświetla się jako
  ten HTML, dopóki strona nie zostanie otwarta — wtedy trafia do panelu jako
  blok **Treść sformatowana**.
- **Lista odstępów banera przechodzi do jego listy elementów.** Baner zapisany
  z **Odstępem po elemencie** zachowuje swoje odstępy w sklepie. Po otwarciu
  strony każdy odstęp przechodzi do swojego elementu w **Elementy: kolejność i
  odstępy**, która wtedy wymienia wszystkie elementy w widocznej kolejności —
  na stronie nic się nie przesuwa.
- **Usunięty blok jest zastępowany elementem zastępczym brakującego bloku.**
  Zapisany `cms.ImageSlider` nie wyświetla klientom nic, reszta strony
  wyświetla się normalnie, a edytor pokazuje w jego miejscu element zastępczy.
  Odtwórz go jako karuzelę.

### Ustawienia sekcji

Blok **Sekcja** (`cms.Section`) ma ustawienia sekcji — kotwicę, schemat
kolorów, tło, odstępy, szerokość, położenie treści i animację wejścia — oraz
miejsce na dowolne inne bloki. Każde ustawienie jest osobnym polem. Szerokość,
Odstęp nad, Odstęp pod, Położenie treści i Nachodzenie na poprzednią sekcję
ustawia się dla każdego progu na karcie
**Responsive** edytora: w **Scope settings** wybierz Base (telefon), Tablet
albo Desktop i ustaw wartość dla tego progu, tak jak w wierszu (Row). Pozostałe
ustawienia są na karcie **General**, a kotwica i animacja wejścia na końcu.
Żaden inny blok nie ma ustawień sekcji; blok poza sekcją wyświetla się
dokładnie tak samo jak samodzielnie.

Sekcja stoi tylko na **najwyższym poziomie** strony albo w
[grupie sekcji](#grupy-sekcji). Każde inne miejsce na bloki — kolumny wiersza,
panel zakładek lub akordeonu, slajd karuzeli, inna sekcja — jej nie przyjmuje,
a edytor cofa upuszczenie jej w takim miejscu. Sekcja
osadzona przez `InsertBlock` na najwyższym poziomie strony wyświetla się jako
sekcja. Bez żadnych ustawień sekcja jest neutralna: bez koloru, o szerokości
Contained i z odstępem `l`.

| Ustawienie | Opcje |
| --- | --- |
| Kotwica (**Anchor**) | Nazwa fragmentu, np. `contact`, dzięki której `/strona#contact` przewija do sekcji. Zob. [Kotwice](#kotwice). |
| Schemat kolorów (**Color scheme**) | Inherit, Light, Muted, Dark. Schemat ustala kolory tekstu, nagłówków, linków, obramowań i przycisków każdego bloku w sekcji. |
| Tło (**Background**) | Brak, jednolity kolor, gradient, obraz albo wideo. Obraz przyjmuje opcjonalny obraz mobilny, punkt ogniskowy, **rozmiar** (Wypełnij, domyślnie; Zmieść, cały obraz; Rozmiar naturalny; albo szerokość w px lub %) i **powtarzanie** (bez powtarzania, domyślnie; kafelki; w poziomie; w pionie); wideo — kadr zastępczy i opcjonalne wideo mobilne. Nad mediami może leżeć nakładka (jednolita lub gradientowa, z kierunkiem i siłą). W schemacie ciemnym **Decorative backdrop** maluje dekoracyjny obraz marki; gdy jest włączone, **Rozmiar tła dekoracyjnego**, **Powtarzanie tła dekoracyjnego** i **Położenie tła dekoracyjnego** ustalają, jak jest rysowane (dopóki się ich nie zmieni: wypełnia sekcję od góry, wyśrodkowane, bez powtarzania). Rozmiar w px zachowuje obraz lub tło dekoracyjne w tym rozmiarze na każdej szerokości ekranu. Przy obrazie lub wideo mobilnym **Gdzie wyświetlać obraz lub wideo na telefony** ustala, gdzie ustępuje ono wersji na komputer: **Telefony (poniżej 768 px)**, domyślnie, albo **Telefony i tablety (poniżej 1024 px)**. |
| Odstęp nad / pod (**Space above** / **Space below**) | Karta Responsive. Stopień skali odstępów marki (`none`, `xs`, `s`, `m`, `l`, `xl`, `xxl`) albo wartość w pikselach, dla każdego progu; próg pozostawiony na **Dziedzicz** przyjmuje wartość progu niższego. Odstęp to wypełnienie (padding), więc dwie sąsiednie ciemne sekcje stykają się i tworzą jeden ciemny obszar. |
| Szerokość (**Width**) | Karta Responsive. Contained, Wide, Full, Viewport (cała szerokość okna i co najmniej cała jego wysokość), Bleed (treść do krawędzi) albo Custom, które pokazuje **Własna maksymalna szerokość (px)**: jedną maksymalną szerokość w pikselach. Ustaw ją dla każdego progu, np. dla sekcji, która na telefonie jest **Bleed** (ramka od krawędzi do krawędzi), a od komputera **Contained**; szerokość wybrana raz obowiązuje na każdym progu, jak dotąd. Szerokość Custom większa niż kontener strony poszerza sekcję poza kontener, wyśrodkowaną, najwyżej do szerokości okna bez bocznego marginesu strony; mniejsza od kontenera zostaje w nim. |
| Szerokość treści (**Content width**) | Widoczna przy Full, Viewport albo Bleed: tło zachowuje ten zasięg, a treść stoi w kontenerze strony, w szerokiej ramce, przy krawędziach albo we własnej maksymalnej szerokości. Ciemny pas przez cały ekran z treścią w kontenerze to **Bleed** z szerokością treści **Kontener strony**; tylko **Viewport** daje dodatkowo sekcję wysoką na cały ekran. Bez wyboru obowiązuje ramka treści samej szerokości. |
| Położenie treści (**Content position**) | Karta Responsive. Góra, środek albo dół, dla każdego progu: gdzie stoi treść, gdy sekcja jest od niej wyższa, jak sekcja Viewport. |
| Nachodzenie na poprzednią sekcję (**Overlap with the previous section**) | Karta Responsive. Stopień skali odstępów marki albo wartość w pikselach, dla każdego progu; do czasu wyboru **Brak**. Treść sekcji przesuwa się o tyle w górę, na dolną część poprzedniej sekcji, i jest rysowana nad jej tłem, a własne tło tej sekcji zostaje na miejscu — np. obraz, który wchodzi w ciemny pas z cechami. Nie przekraczaj odstępu pod poprzedniej sekcji, bo inaczej jej treść zostanie zasłonięta. Pierwszy blok strony na nic nie nachodzi. W edytorze treść się nie przesuwa, żeby poprzednią sekcję dało się łatwo zaznaczyć; zakreskowany pas u góry sekcji pokazuje, jak daleko będzie nachodzić na oglądanym progu. |
| Animacja wejścia (**Entrance reveal**) | Brak albo pojawienie się z przesunięciem w górę (fade-up), opcjonalnie tylko na komputerze. Zob. [Ruch](#ruch). |

Zapis do newslettera w sekcji z kotwicą przenosi odwiedzającego z powrotem do
tej kotwicy po zapisie bez JavaScriptu.

**Pusta sekcja nie zajmuje miejsca.** Gdy żaden blok sekcji nie pokazuje
niczego na stronie — lista aktualności bez wpisów, lista produktów bez
produktów albo bloki ukryte na danym progu przez **Hide on** — opublikowana
sekcja rezygnuje z odstępu nad i pod (oraz z nachodzenia i minimalnej
wysokości), więc na stronie nie zostaje pusty pas. Sekcja z obrazem albo wideo
w tle zachowuje swój rozmiar, bo media są jej treścią. Edytor zawsze pokazuje
sekcję z odstępami, żeby dało się w niej upuszczać bloki. Przeglądarki bez
obsługi selektora CSS `:has()` (starsze niż z 2023 r.) pokazują pusty odstęp
tak jak dotąd.

### Grupy sekcji

**Grupa sekcji** (`cms.SectionGroup`) mieści ciąg sekcji i maluje za nimi
wszystkimi jedno tło. Przydaje się, gdy kilka sąsiednich sekcji tworzy wspólny
ciemny pas z dekoracyjnym tłem marki: w osobnych sekcjach każda maluje własną
kopię tła dekoracyjnego od swojej górnej krawędzi, więc na każdej granicy
widać ostre cięcie; w grupie tło dekoracyjne jest malowane raz, od górnej
krawędzi grupy, i ciągnie się za wszystkimi jej sekcjami.

Grupa stoi tylko na **najwyższym poziomie** strony, a jej miejsce na bloki
przyjmuje **wyłącznie sekcje**: edytor cofa upuszczenie w niej każdego innego
bloku, a także upuszczenie grupy w dowolnym miejscu na bloki. Jej ustawienia:

| Ustawienie | Opcje |
| --- | --- |
| Schemat kolorów | Dziedzicz, Jasny, Stonowany, Ciemny. Sekcje w grupie przyjmują ten schemat, chyba że ustawią własny. |
| Tło | Te same możliwości co w sekcji: brak, jednolity kolor, gradient, obraz albo wideo, z nakładką, a w schemacie ciemnym **Tło dekoracyjne**. Jest malowane raz, na całą szerokość okna, za wszystkimi sekcjami grupy. |
| Odstęp nad / Odstęp pod | Karta Responsive. Stopień skali odstępów marki albo wartość w pikselach, dla każdego progu; **None**, dopóki nie zostanie ustawiony, bo sekcje mają własne odstępy. |
| Kotwica | Nazwa fragmentu dla całej grupy, jak w sekcji. |

Gdy grupa coś maluje — ma schemat albo tło — sekcja w niej bez własnego tła i
ze schematem grupy (albo **Dziedzicz**) jest przezroczysta, więc prześwituje
przez nią tło grupy. Sekcja, która ustawia tło, tło dekoracyjne albo inny
schemat, maluje je jak zwykle, na przykład jasny pas w ciemnej grupie. Bez
schematu i bez tła grupa niczego nie maluje, a jej sekcje wyglądają tak, jak
wyglądałyby bez niej.

W grupie sekcja zachowuje całą resztę: szerokość, odstępy, szerokość treści,
kotwicę i nachodzenie. Pierwsza sekcja grupy może nachodzić na blok przed
grupą (najpierw przykrywa własny odstęp nad grupy); pierwsza sekcja grupy,
która otwiera stronę, na nic nie nachodzi. Pusta sekcja w grupie nie zajmuje
miejsca, jak wszędzie, a grupa, której żadna sekcja niczego nie pokazuje,
rezygnuje też z własnego odstępu nad i pod. Grupa zapisana wewnątrz innego
bloku (edytor na to nie pozwala) wyświetla tylko treść swoich sekcji.

### Schematy kolorów

Trzy schematy — jasny, stonowany i ciemny — definiuje się raz na ekranie
[Marka](./brand.md). Sekcja ze schematem wyświetla
`data-cmsb-scheme="light|muted|dark"`, co podmienia zmienne schematu
(`--cmsb-fg`, `--cmsb-bg`, `--cmsb-fg-muted`, `--cmsb-border`,
`--cmsb-link`) dla całej jej zawartości. Pola kolorów w blokach przyjmują też
kolor marki: wybór koloru pokazuje najpierw **Brand colors** i zapisuje token,
np. `token:primary`, który podąża za późniejszymi zmianami marki. Wartość hex
pozostaje dostępna jako nadpisanie.

W sekcji ze schematem drugorzędny tekst bloków — opisy cech, SKU i stan
magazynowy produktu, liczby w kategoriach, nieaktywna i aktywna karta — przyjmuje
stonowany albo główny kolor tekstu schematu, więc pozostaje czytelny na
schemacie ciemnym. Jasnoszare tło pod obrazem kafelka z linkiem i obrazu
karuzeli ustępuje tłu samej sekcji, więc grafika z przezroczystym tłem nie
leży na jasnej karcie w ciemnej sekcji; element bez obrazu pokazuje zamiast
tego delikatny odcień koloru tekstu schematu. Karta produktu z obramowaniem
przyjmuje tło i obramowanie schematu, a aktywna karta w stylu pigułek odwraca
kolory schematu. Poza sekcją ze schematem wszystko to wygląda jak dotąd.

### Kotwice

Kotwica sekcji i kotwica nagłówka w treści sformatowanej stają się
identyfikatorami elementów, a przycisk, link w tekście sformatowanym albo pole
linku rodzaju **In-page anchor** może do nich prowadzić. Edytor normalizuje
wpisany tekst — małe litery, ASCII, łączniki, litera na początku, najwyżej 64
znaki — więc `Contact Us!` zmienia się w `contact-us`, a `9x` w `a-9x`. Pole
linku podpowiada kotwice obecne w bieżącej zawartości: kotwice sekcji i grup
sekcji na najwyższym poziomie oraz sekcji w grupie.

Zapis treści strony, bloku albo szablonu jest odrzucany z `422`, gdy kotwica
łamie jedną z dwóch reguł, sprawdzanych osobno dla drzewa każdego języka:

| Błąd | Kiedy |
| --- | --- |
| `CMS_DUPLICATE_ANCHOR` (`details.anchor`) | Ta sama kotwica występuje dwa razy w treści jednego języka. Kotwica sekcji i kotwica nagłówka kolidują ze sobą; ta sama kotwica w dwóch językach jest dozwolona. |
| `CMS_RESERVED_ANCHOR` (`details.anchor`) | Kotwica to identyfikator, którego używa już układ storefrontu: `main-content`, `cmsb`, `cmsb-header-offset`, `b2b-locale`, `b2b-currency`, `ga-gtag-src`, `ga-gtag-init`, `gtm-init`. |

Lista zastrzeżonych identyfikatorów to `RESERVED_ANCHORS` w
`packages/contracts/src/page-builder-values.ts`, udostępniana przez storefront
jako `storefront/app/reserved-anchors.ts`. Liczą się tylko kotwice sekcji i
grup sekcji na najwyższym poziomie oraz sekcji w grupie, bo tylko one
wyświetlają identyfikator.
Odrzucony zapis niczego nie zapisuje i nie tworzy wpisu audytu. Storefront
przesuwa cel przewijania o wysokość przyklejonego nagłówka
(`scroll-margin-top: var(--cmsb-header-offset)`).

### Gotowe sekcje

Szuflada bloków oferuje gotowe sekcje — hero, media i tekst, kartę wezwania do
działania, pliki do pobrania, siatkę funkcji i hasło — złożone z powyższych
bloków, z neutralnym tekstem przykładowym w języku edytora. Każda gotowa
sekcja to sekcja z jednym blokiem. Wstawienie dodaje ją na najwyższym
poziomie, za sekcją zaznaczonego bloku albo na końcu strony, nie zastępując
zawartości; gdy zaznaczony blok stoi w sekcji grupy sekcji, gotowa sekcja
trafia do tej grupy, za jego sekcję; potem
wszystko w niej edytuje się jak każdy inny blok. Gotowe sekcje są kodem
(`packages/cms-components/src/editor/section-presets.ts`), wersjonowanym
razem z blokami, z których się składają, a ich teksty są w pakiecie
tłumaczeń `cms` pod `presets.*`.

### Strona nadrzędna i ścieżka nawigacji

Karta **Ścieżka nawigacji** w edytorze strony ustawia:

- **Strona nadrzędna** — strona pokazywana przed tą w ścieżce nawigacji
  (breadcrumbs). Zmienia adres strony tylko z opcją opisaną niżej. Strona nie może być własnym
  rodzicem ani trafić pod jedną ze swoich podstron, a drzewo ma najwyżej osiem
  poziomów; odrzucony wybór kończy się `422 CMS_PAGE_PARENT_CYCLE`. Usunięcie
  rodzica czyści to pole w stronach podrzędnych.
- **Dołącz ścieżkę strony nadrzędnej do adresu** — domyślnie wyłączone, więc
  strona zachowuje płaski adres `/<slug>`. Po włączeniu strona jest dostępna
  pod adresem rodzica: `/<ścieżka rodzica>/<slug>`. Adres rodzica podlega tej
  samej regule, więc drzewo, w którym wszystkie niższe strony mają tę opcję,
  daje adresy takie jak `/uslugi/doradztwo/warsztaty`.
  Zobacz *Zagnieżdżone adresy stron* niżej.
- **Pokazuj ścieżkę nawigacji** — domyślnie włączone.
- **Schemat kolorów ścieżki nawigacji** — jasny (domyślny, niczego nie maluje),
  stonowany albo ciemny. Na stonowanym i ciemnym linki mają przygaszony kolor
  tekstu schematu (po najechaniu jego kolor tekstu), a bieżąca strona kolor
  tekstu.
- **Pokazuj ścieżkę nawigacji na pierwszej sekcji** — domyślnie wyłączone.
  Włączone kładzie ścieżkę na górze pierwszej sekcji strony (np. hero) zamiast
  w pasie nad nią i nic na stronie nie przesuwa się w dół: żaden pas nie jest
  malowany, a ścieżka zostaje w kontenerze strony i bocznym marginesie marki.
  Wybierz schemat **ciemny**, aby ścieżka była jasna na ciemnym obrazie.
  Pierwsza sekcja nie dostaje automatycznie miejsca na ścieżkę — ustaw jej
  wystarczający górny odstęp (**Odstęp nad** albo własny odstęp hero), aby
  ścieżka nie zasłaniała treści.

Storefront wyświetla *Strona główna › przodkowie › strona*. Każdy element
ścieżki ma etykietę z **nazwy** strony — tak samo bieżąca strona, jak każdy
przodek (do 2026-10-27 przodek pokazywał zamiast niej swój meta tytuł). Przodek
nieopublikowany w kanale sprzedaży żądania jest pokazywany jako zwykły tekst,
nie jako link, a jego slug nigdy nie przechodzi między kanałami. Ścieżka stoi
w kontenerze strony i bocznym marginesie marki, więc jest wyrównana z treścią
strony. W schemacie stonowanym lub ciemnym malowany pas sam trzyma odstęp pod
ścieżką, więc ciemna pierwsza sekcja następuje po nim bez jasnego paska
pomiędzy. Dane
strukturalne `BreadcrumbList` ścieżki używają adresów bezwzględnych. Te pola
są zapisane w `cms_pages` (`parent_page_id`, `breadcrumbs_visible`,
`breadcrumbs_scheme`, `breadcrumbs_overlay`, `share_image_asset_id`) i wchodzą
do wpisu audytu `cms_page.update`.

### Zagnieżdżone adresy stron

**Ścieżka publiczna** strony to jej własny slug albo — gdy włączona jest opcja
**Dołącz ścieżkę strony nadrzędnej do adresu** (`parentPathInUrl`, zapisana
jako `cms_pages.parent_path_in_url`) — ścieżka publiczna rodzica, `/` i slug
strony. Ścieżka jest wyliczana przy odczycie strony, osobno dla każdego kanału
sprzedaży, ze slugów, pod którymi kanał udostępnia strony; nigdy nie jest
zapisywana. Dlatego:

- **Zmiana sluga albo przeniesienie rodzica przenosi każdą zagnieżdżoną stronę
  pod nim.** Stary adres przestaje odpowiadać; nie ma z niego automatycznego
  przekierowania.
- **Własny slug strony nadal odpowiada** — trwałym przekierowaniem (308) na jej
  ścieżkę, więc linki sprzed włączenia opcji działają dalej.
- **Rodzic, którego kanał nie udostępnia**, zostawia stronę w tym kanale pod
  jej własnym slugiem.
- **Dwie strony nie mogą mieć jednego adresu w jednym kanale.** Zapis, który
  dałby stronie — albo zagnieżdżonej stronie pod nią — adres innej strony,
  jest odrzucany z `409 CMS_SLUG_CONFLICT` i niczego nie zapisuje.
- Pierwszy segment zagnieżdżonego adresu to slug strony najwyższej, który
  sprawdza już reguła zastrzeżonych segmentów, więc zagnieżdżona strona nie
  przesłoni trasy storefrontu, takiej jak `/p/…`, `/c/…`, `/cart` czy
  `/account`.

Edytor strony pokazuje wynikowy adres w polu **Adres publiczny**. Linki ścieżki
nawigacji w storefroncie, link kanoniczny, `og:url` i mapa witryny używają
ścieżki, a link Page Buildera do strony prowadzi pod jej ścieżkę w kanale
żądania.

### Nazwa, slug i opis w każdym języku

**Nazwa**, **Slug** i **Opis** strony w karcie *Metadane strony* to jej
wartości domyślne. Karta **Wersja językowa** daje każdemu językowi strony
własną nazwę, slug i opis, obok tytułu, opisu i słów kluczowych meta w tym
języku. Puste pole oznacza wartość strony, którą karta pokazuje na szaro jako
podpowiedź. Karta edytuje język widoczny na płótnie: zakładki języków w karcie
i nad płótnem przełączają oba. Dopóki slug języka nie został wpisany, podąża
za nazwą w tym języku, tak jak slug nowej strony podąża za jej nazwą.

Nadpisania są zapisane w `cms_pages.translations`
(`{ "<lang>": { "name", "slug", "description" } }`, `{}` dla strony, która
niczego nie nadpisuje) i wchodzą do wpisu audytu `cms_page.update`.
Nadpisanie działa tylko wtedy, gdy strona ma dany język: usunięcie języka ze
strony zostawia jego nadpisania zapisane, ale nieużywane, a ponowne dodanie
języka je przywraca. API odrzuca nadpisanie języka, którego strona nie ma,
kodem `400 CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE`.

W storefroncie:

- **Każdy język ma własny adres ze swoim slugiem** — a dla strony
  zagnieżdżonej także ze slugami przodków w tym języku, pod prefiksem tego języka,
  tak jak adres produktu: `/pl/o-nas` po polsku, `/en/about-us` po angielsku
  (`/o-nas`, gdy kanał nie dodaje prefiksu do języka domyślnego — zob. *Kanały
  sprzedaży*).
- **Stronę można znaleźć po slugu w dowolnym z jej języków** oraz po jej
  własnym slugu, a wyświetla się w języku odwiedzającego. Gdy żądany adres nie
  jest adresem strony w tym języku — odwiedzający zmienił język na stronie —
  storefront odpowiada trwałym przekierowaniem (308) na właściwy.
- **Dwie strony nie mogą mieć tego samego adresu w jednym kanale i jednym
  języku.** Ten sam slug może należeć do jednej strony po polsku i do innej po
  angielsku. Zapis, który łamie tę zasadę, jest odrzucany kodem
  `409 CMS_SLUG_CONFLICT` (`details.language` wskazuje język) i nic nie jest
  zapisywane.
- Nazwa strony w wyświetlanym języku jest zapasowym tytułem i jej pozycją w
  każdej ścieżce nawigacji, a link Page Buildera do strony prowadzi pod jej
  adres w wyświetlanym języku.
- Link kanoniczny to adres w wyświetlanym języku; każdy język jest alternatywą
  `hreflang`, a mapa witryny podaje adres każdego języka z pozostałymi jako
  alternatywami. Reguła zastrzeżonych segmentów sprawdza slug każdego języka.

Opis to wewnętrzna notatka strony i nie jest pokazywany w storefroncie.
Wyszukiwarka na liście stron znajduje stronę po nazwie lub slugu w dowolnym
języku.

### Obraz do udostępniania i metadane dla wyszukiwarek

Karta **Udostępnianie** w edytorze strony wybiera **Obraz do udostępniania** z
biblioteki zasobów — większości serwisów odpowiada rozmiar około 1200 × 630 px.
Bez niego strona używa ustawienia `cms.default_share_image_asset_id`
(**Ustawienia → Page Builder → Default sharing image**, można je ustawić
osobno dla kanału sprzedaży). Publikowane są tylko zasoby publiczne. Zasobu
użytego jako obraz do udostępniania nie można usunąć (`409 ASSET_REFERENCED`).

Storefront publikuje wtedy, dla strony CMS i dla strony głównej opartej na CMS:

- `og:image` oraz `twitter:card` `summary_large_image`, gdy obraz istnieje
  (w przeciwnym razie `summary`);
- `og:locale` dla wyświetlanego języka i `og:locale:alternate` dla pozostałych
  języków strony, które mają treść. Strona CMS ma też linki `hreflang`, po
  jednym na język, bo każdy język ma własny adres (zob. *Nazwa, slug i opis w
  każdym języku*). Strona główna oparta na CMS ich nie ma: `/` obsługuje
  wszystkie języki;
- dane strukturalne `Organization` z logo sklepu i profilami społecznościowymi
  z modułu Settings (`shop.logo_asset_id`, `shop.social_profiles`).

### Nagłówki: grubość i szerokość

Nagłówek bloku zachowuje wygląd swojego rozmiaru, dopóki nie wybierzesz
inaczej. Zmieniają go dwie opcje:

- **Grubość nagłówka**: **Domyślna** (grubość właściwa rozmiarowi, jak dotąd)
  albo grubość od Cienkiej (300) do Bardzo grubej (800).
- **Maksymalna szerokość nagłówka**, dla każdego progu na karcie Responsive:
  domyślnie **Brak (pełna szerokość)**, **Wąska**, **Średnia**, **Szeroka**
  (około 36, 48 i 60 rem) albo **Własna (px)**. Długi nagłówek zawija się
  wtedy na tej szerokości; w wyśrodkowanym bloku pozostaje wyśrodkowany.

Obie opcje mają blok multimediów z tekstem, panel z obrazem w tle, karta
wezwania do działania, lista linków, lista cech, statystyki oraz nagłówek
karuzeli, siatki i karuzeli produktów i najnowszych wpisów. Hasło ma tylko
grubość: jego **Maksymalna szerokość tekstu** obejmuje już nagłówek i tekst.
W banerze ta sama para to **Grubość tytułu** i **Maksymalna szerokość
tytułu**.

Grubość mają też mniejsze teksty: **Grubość tytułu** listy cech (każdy tytuł
elementu), **Grubość podpisu** obrazu karuzeli, **Grubość tytułu** i
**Grubość etykiety** kafelka z linkiem oraz **Grubość nazwy na karcie** list
produktów (nazwa produktu na każdej karcie). **Domyślna** zachowuje ich
wygląd.

Karuzela i karta produktu używają **czcionki tekstu** marki, tak jak teksty
innych bloków: pasek filtrów, wprowadzenie w nagłówku i teksty kart idą za
ekranem marki. Bez ustawionej czcionki marki zachowują czcionkę strony.

### Ikony w nagłówkach i podpisach

Każdy tekst edytowany jako tekst sformatowany w jednej linii — nagłówek, tytuł
bloku, podpis obrazu w karuzeli — może zawierać ikonę z tego samego katalogu
ikon, którego używają lista cech i blok ikon. Ustaw kursor, wybierz **Wstaw
ikonę** na pasku narzędzi tekstu i wskaż ikonę; można ją wyszukać po nazwie.
Ikona stoi w linii tekstu, w jego rozmiarze i kolorze (wewnątrz wyróżnienia
gradientem przyjmuje kolor akcentu), i usuwa się ją jak znak.

W tym samym oknie, przed wskazaniem ikony, **Rozmiar ikony** ustala jej
wielkość: **Rozmiar tekstu (1 em)**, domyślnie; **Względem tekstu (em)**, od 0,5
do 3 razy rozmiar tekstu, więc ikona skaluje się z nagłówkiem na każdym
ekranie; albo **Stały (px)**, od 8 do 200 pikseli. **Przesunięcie w pionie
(em)** podnosi ikonę (wartość dodatnia, najwyżej 1) albo ją obniża (wartość
ujemna, najmniej −1), w jednostkach rozmiaru tekstu; puste pole zostawia ikonę
w linii, jak dotąd. Aby zmienić ikonę, która już jest w tekście, zaznacz ją (na
przykład klawiszami strzałek) i wybierz **Edytuj ikonę**: okno otwiera się z
jej wartościami, **Zastosuj** zostawia ikonę i zapisuje nowy rozmiar i
przesunięcie, a wskazanie innej ikony ją zastępuje.

Ikona jest ozdobą: czytniki ekranu jej nie widzą, więc nagłówek jest czytany
samymi słowami, i nie jest wysyłana do tłumaczenia — przetłumaczony nagłówek
zachowuje ją w miejscu, w które wstawi ją tłumaczenie.

### Nagłówki w tekście sformatowanym i skala typografii

Nagłówki pisane w tekście sformatowanym — w bloku Treść sformatowana i w
tekście bloku media i tekst, karty wezwania do działania, hero, listy cech i
pozostałych bloków z tekstem sformatowanym — idą za **skalą typografii**
[ustawień marki](./brand.md): Nagłówek 4 w tekście przyjmuje rozmiar Nagłówka 4
(na telefonie i na komputerze), interlinię, grubość i odstępy między literami.
Dopóki skala typografii nie jest ustawiona dla danego poziomu, nagłówki tego
poziomu wyglądają jak dotąd.

### Rozmiary tekstu, wysokość linii i odstępy w blokach

Mniejsze teksty bloków treści mają własny wygląd; każda opcja jest pusta albo
ustawiona na **Domyślny**, dopóki jej nie zmienisz, więc blok już umieszczony na
stronie wygląda jak dotąd. W każdym bloku obowiązują trzy zasady:

- **Rozmiar to stopień skali typografii albo Własny (px).** Stopień (**Tekst
  podstawowy**, **Wprowadzenie**, **Nagłówek 4** …) przynosi ze sobą wysokość
  linii, grubość i odstęp między literami tego stopnia z marki, na każdym progu
  — więc tekst ustawiony na **Tekst podstawowy** wszędzie wygląda jak tekst
  podstawowy. Rozmiary ustawia się dla każdego progu na karcie **Responsive**.
- **Wysokość linii jest dostępna tylko przy rozmiarze Własny (px).** Stopień ma
  już swoją; wysokość linii (wielokrotność rozmiaru, np. 1,5) działa tylko na
  progu, którego rozmiar jest Własny (px).
- **Grubość to jedna wartość dla każdego progu.** Wygrywa z grubością stopnia.
  Grubość zapisana dla każdego progu przez wcześniejszą wersję tych opcji jest
  odczytywana jako jej wartość z komputera, a w braku tej — wartość bazowa.

Odstępy wewnątrz bloku to jeden stopień skali odstępów marki (**Brak**, **XS**
… **XXL**), a nie wartość w pikselach dla każdego elementu; stopień ma własny
rozmiar na telefon i na komputer, więc podąża za progami i za marką.

- **Lista funkcji**: **Rozmiar tekstu**, **Grubość tekstu** i **Wysokość linii
  tekstu** dla tekstu każdego elementu (domyślnie mała, przygaszona linia);
  **Wysokość linii tytułu** przy własnym rozmiarze tytułu; **Odstęp wewnątrz
  elementu** — odstęp za ikoną, pod tytułem i między akapitami. **Położenie
  ikony: Obok tytułu** stawia ikonę na początku tytułu, a tytuł i tekst wiszą
  obok niej: zawinięta linia zaczyna się pod tekstem, nie pod ikoną.
- **Hero**: podtytuł i hasło mają **grubość**, **wysokość linii** (przy
  rozmiarze własnym) i **maksymalną szerokość**, jak tytuł; tekst ma **Rozmiar
  tekstu** (domyślnie 16 px), **grubość**, **wysokość linii** i **maksymalną
  szerokość**. Hero ma jeden **Kolor tekstu** dla wszystkich swoich tekstów;
  nadtytuł może mieć własny **Kolor nadtytułu** jako akcent. **Odstęp między
  elementami** ma opcję **Własny (px)**. Przy mediach **Nad treścią** **Odstęp
  pod mediami** ustawia odstęp między obrazem lub wideo a tekstami (domyślnie
  brak). Obraz dowodu społecznego zachowuje wysokość 40 px.
- **Hasło**: **Wysokość linii nagłówka** (przy własnym rozmiarze nagłówka) oraz
  **rozmiar**, **grubość** i **wysokość linii** tekstu uzupełniającego. Na
  obrazie w tle **Minimalna wysokość** (**Domyślna** to 60 % wysokości ekranu;
  także połowa, trzy czwarte, cały ekran, **Automatyczna** albo **Własna
  (px)**).
- **Statystyki**: **rozmiar** i **grubość** etykiet (ich kolor to przygaszony
  tekst schematu; **Kolor wartości** pozostaje akcentem liczb). Obok obrazu, od
  tabletu w górę, **Układ (obraz – liczby)** rozkłada obraz i liczby na 12
  kolumnach (zob. *Układy na 12 kolumnach* niżej), a **Położenie liczb w
  pionie**: **Środek** (domyślnie), **Góra**, **Dół** albo **Rozłożone na
  wysokość obrazu**.
- **Lista odnośników**: **Rozmiar tytułu wiersza** i **Grubość tytułu
  wiersza**.
- **Karta wezwania do działania**: **Zaokrąglone narożniki** (**Domyślne**
  zachowują dotychczasowe) i **Odsunięcie obrazu**: domyślnie wewnętrzny odstęp
  karty, **Brak** (obraz sięga krawędzi karty) albo **Własne (px)**, jedna
  wartość dla każdego progu.
- **Media i tekst**: **Obok siebie od** tabletu (768 px, domyślnie) albo
  komputera (1024 px); poniżej media i tekst układają się jedno pod drugim, w
  **Kolejności na telefonie**.
- **Treść sformatowana**: **Rozmiar tekstu** i **Grubość tekstu** całego
  tekstu; listy za nimi podążają.
- **Wiersz**: **Odstęp między wierszami (px)** ustawia się dla każdego progu;
  jedna wartość zapisana wcześniej obowiązuje na każdej szerokości.

W każdym tekście sformatowanym **Rozmiar tekstu** na pasku narzędzi zmienia
rozmiar zaznaczonych słów na stopień skali typografii, a **Znacznik listy**
wybiera znaczniki listy punktowanej: **Kropka** (domyślnie), **Znaczek
wyboru**, **Szewron** albo **Brak**. Strona i edytor pokazują je tak samo.
Słowa, którym wcześniejsza wersja paska nadała rozmiar w pikselach, zachowują
go, dopóki nie wybierzesz dla nich stopnia. Znaczek wyboru jest rysowany w
głównym kolorze marki, a szewron w kolorze tekstu; **Kolor znaczników listy**
bloku (Treść sformatowana, Media i tekst) nadaje obu znacznikom własny kolor,
np. białe znaczki na ciemnej sekcji.

Blok **Tekst** przyjmuje pogrubienie, kursywę, linki i wyróżnienia: jego tekst
edytuje się jak nagłówek. Tekst zapisany wcześniej pozostaje zwykłym tekstem,
dopóki nie zostanie edytowany.

Nagłówek zaczynający się od ikony może zawiesić tekst obok niej: **Wcięcie
wiszące za ikoną na początku** utrzymuje zawiniętą linię pod tekstem, który
zaczyna się 0,35 em za ikoną.

#### Układy na 12 kolumnach

Media i ich tekst obok siebie — **Slajd z mediami i tekstem**, **Statystyki**
obok obrazu i **Karta wezwania do działania** z obrazem — mają **Układ** od
szerokości „obok siebie” w górę: **Domyślny** (dwie równe połowy, jak dotąd)
albo gotowy układ kolumn z 12, nazwany od mediów — **6 – 6**, **7 – 5**,
**5 – 7**, **8 – 4**, **4 – 8** oraz **5 – 1 – 6** albo **6 – 1 – 5** z
kolumną odstępu (nie w karcie). Przy mediach po prawej układ jest odbity
lustrzanie. **Układ zaawansowany (kolumny z 12)** pokazuje zamiast tego
szerokości w kolumnach, kolumny między nimi i **Wyrównanie kolumn do**, a te
wygrywają z gotowym układem, dopóki przełącznik jest włączony; szerokości
zapisane, zanim pojawił się przełącznik, otwierają się z nim włączonym.
**Media i tekst** zachowuje **Podział (media – tekst)** jako układ i ma ten sam
przełącznik dla swoich szerokości w kolumnach z 12.

**Wyróżnienie gradientem**, które zawija się na kilka linii, jest jednym
gradientem na całą frazę: każda linia go kontynuuje, zamiast zaczynać od nowa.

### Karuzele: sterowanie, siatka i filtr

Poniższe opcje są w karuzeli; położenie, styl i wyrównanie strzałek oraz
zapętlenie dotyczą również karuzeli produktów i karuzeli najnowszych wpisów.

| Opcja | Gdzie | Co robi |
| --- | --- | --- |
| **Położenie strzałek** | Karta Responsive | Pod slajdami, w nagłówku albo na slajdach, osobno dla każdego progu. Na przykład strzałki w nagłówku na komputerze i pod slajdami na telefonie. |
| **Styl**, **kształt**, **rozmiar**, **kolor strzałek** | Sterowanie (karta General) | Styl: domyślne jasne kółko, kontur albo wypełnienie. Kształt: okrągły albo kwadratowy. Rozmiar: 32, 36 (domyślnie) albo 44 px. Kolor: kolor marki albo wartość hex, użyty do konturu i ikony albo jako wypełnienie. Bez wyboru strzałki wyglądają jak dotąd. |
| **Ikona strzałek** | Sterowanie (karta General) | **Szewron** (domyślnie, jak dotąd) albo **Strzałka**, narysowana strzałka z katalogu ikon. Przyciski, ich nazwy dla czytników ekranu i opcje ich stylu pozostają takie same. |
| **Styl strzałki „dalej”** | Sterowanie (karta General) | **Jak styl strzałek** (domyślnie) albo własny styl strzałki „dalej”: na przykład strzałka „wstecz” z konturem obok wypełnionej strzałki „dalej”. Kształt, rozmiar i kolor pozostają wspólne. |
| **Wyrównanie przycisków** | Karta Responsive | Gdzie stoją strzałki i kropki pod slajdami, osobno dla każdego progu: **Do środka** (domyślnie), **Do początku**, **Do końca**, **Rozłożone** albo **Strzałki po obu stronach** z kropkami pośrodku. Zmienia się tylko położenie: kolejność klawiatury pozostaje: wstecz, kropki, dalej. |
| **Wyrównaj przyciski do** | Karta General | **Krawędzi treści** (domyślnie) albo **Pierwszego slajdu**: strzałki i kropki pod slajdami wyrównują się do pierwszego slajdu zamiast do treści. Przy **Wyjściu poza krawędź treści** przyciski kończą się wtedy tam, gdzie kończy się pierwszy slajd, a nie przy krawędzi treści. Strzałki w nagłówku i na slajdach się nie przesuwają. |
| **Zapętlenie na końcach** | Karta General | **Tak** (domyślnie, jak dotąd): strzałka „wstecz” na pierwszym slajdzie przechodzi do ostatniego, a strzałka „dalej” na ostatnim slajdzie wraca do pierwszego. **Nie**: karuzela zatrzymuje się na końcach, a strzałka, która nie może przejść dalej, jest nieaktywna — czytnik ekranu ogłasza ją jako niedostępną, a klawisz Tab ją pomija; jeśli miała fokus klawiatury, fokus przechodzi na drugą strzałkę. Autoodtwarzanie zatrzymuje się wtedy na ostatnim slajdzie. |
| **Wygląd nieaktywnej strzałki (bez zapętlenia)** | Sterowanie (karta General) | Jak wygląda strzałka nieaktywna na końcu: **Przygaszona** (domyślnie), **Jasny obrys (ciemne tło)** — przezroczysta strzałka z delikatnym białym obrysem — albo **Kolor**, obrys w kolorze **Kolor nieaktywnej strzałki** (kolor marki albo wartość hex). |
| **Układ** | Karta General | **Karuzela** (domyślnie) albo **Siatka**. Siatka pokazuje wszystkie elementy w **kolumnach** dla każdego progu (1–6, ustawiane na karcie Responsive), bez strzałek, kropek i automatycznego przewijania. Każdy rodzaj elementu działa w obu układach. |
| **Filtr** | Karta General | **Pokaż pasek filtrów**, **etykieta „Wszystkie”** (pusta: wyświetlane jest słowo w języku strony) i **tagi do filtrowania**, każdy z etykietą widoczną dla odwiedzających. **Styl paska**: **Pigułki** (domyślnie) albo **Zakładki z podkreśleniem**, z linią pod paskiem i podkreślonym wybranym tagiem. **Wyrównanie paska**: **Do lewej** (domyślnie), **Do środka** albo **Do prawej**. **Przyciski, które się nie mieszczą**: **Zawijaj do kolejnych wierszy** (domyślnie) albo **Przewijaj w jednym wierszu**. |

Aby filtrować, nadaj każdemu elementowi **tagi** (oddzielone przecinkami, na
przykład `biura, handel`) i wpisz te same tagi w filtrze karuzeli. Tagi są
porównywane bez względu na wielkość liter i otaczające spacje. Tłumaczone są
tylko etykiety; tagi pozostają bez zmian.

Pasek filtrów to rząd przycisków przełączających, który na wąskim ekranie
zawija się do kolejnego wiersza; przy **Przewijaj w jednym wierszu** zostaje
jednym wierszem, który odwiedzający przesuwa w bok, zatrzymującym się na
przycisku, a przycisk wybrany klawiszami albo dotknięciem przewija się do
widoku, nie przesuwając strony w bok. Klawiatura przechodzi między przyciskami
strzałkami, klawiszami Home i End, a czytnik ekranu po każdej zmianie podaje,
ile elementów jest widocznych. Filtrowanie odbywa się tylko w przeglądarce:
każdy element jest w HTML wyświetlanym przez serwer, więc wyszukiwarka
i odwiedzający bez JavaScriptu widzą je wszystkie.

**Przyciemnienie pod podpisem** obrazu karuzeli przyciemnia obraz za podpisem
umieszczonym na obrazie, aby był czytelny na wyrazistym zdjęciu: gradient od
krawędzi podpisu albo równomierne przyciemnienie, o sile 0–90 %. Z
przyciemnieniem podpis traci własne ciemne tło, chyba że nadano mu kolor tła.

**Rozmiar podpisu** obrazu karuzeli oraz **Rozmiar tytułu** i **Rozmiar
etykiety** kafelka z linkiem to rozmiar ze skali typografii (Mały, Tekst
podstawowy, Wprowadzenie, Nagłówek 1–6, Ekspozycyjny) albo wartość **Własny
(px)**, wybierane dla każdego progu na karcie Responsive; **Czcionka
podpisu**, **Czcionka tytułu** i **Czcionka etykiety** wybierają czcionkę
nagłówków albo tekstu marki, a **Grubość podpisu**, **Grubość tytułu**
i **Grubość etykiety** — grubość od 300 do 800. Przy ustawieniu **Domyślny**
podpis ma jak dotąd 14 px i półgrube pismo, a tytuł 18 px. **Styl etykiety** kafelka z linkiem to
**Link tekstowy ze strzałką** (domyślnie), **Przycisk** w wyglądzie
głównego przycisku albo **Brak**; cały kafelek w każdym przypadku pozostaje
jednym linkiem.

**Kolor podpisu po najechaniu** obrazu karuzeli oraz **Kolor tytułu po
najechaniu** i **Kolor etykiety po najechaniu** kafelka z linkiem (kolor marki
albo wartość hex) zmieniają kolor tego tekstu, gdy wskaźnik jest nad
elementem albo element ma fokus klawiatury, z krótkim płynnym przejściem
między kolorami — natychmiastowym dla odwiedzającego, który woli ograniczony
ruch. Kolor etykiety dotyczy etykiety w postaci linku tekstowego; etykieta
w postaci przycisku zachowuje wygląd przycisku po najechaniu. Pozostawione
puste — tekst zachowuje swój kolor.

**Kolor tytułu** i **Kolor etykiety** kafelka z linkiem (kolor marki albo
wartość hex) ustawiają kolor tytułu i etykiety w postaci linku tekstowego
w spoczynku, dzięki czemu kolor po najechaniu ma od czego się zmieniać — na
przykład szary tytuł, który po najechaniu robi się biały. Etykieta w postaci
przycisku zachowuje kolory przycisku. Pozostawione puste — tytuł i etykieta
mają swoje zwykłe kolory.

Oba kolory ustawia się dla każdego progu na karcie **Responsive**, więc kafelek
może mieć w spoczynku jeden kolor na telefonach i tabletach, a inny na
komputerze — na przykład biały tytuł na obrazie na wąskich ekranach i ciemny
pod nim na szerokich. Kolor ustawiony dla jednego progu obowiązuje od tego
progu w górę, dopóki szerszy próg nie ma własnego; próg poniżej pierwszego
z kolorem zachowuje zwykły kolor. Kolor ustawiony, zanim pojawiła się ta
opcja, jest kolorem każdego progu, jak dotąd. Kolor po najechaniu nadal ma
pierwszeństwo.

**Grubość podpisu** obrazu karuzeli oraz **Grubość tytułu** i **Grubość
etykiety** kafelka z linkiem także ustawia się dla każdego progu na karcie
**Responsive**, więc tytuł kafelka może mieć grubość normalną na telefonach i tabletach,
a średnią na komputerze. Grubość ustawiona dla jednego progu obowiązuje od tego
progu w górę, dopóki szerszy próg nie ma własnej; próg poniżej pierwszego
z grubością albo pozostawiony na **Domyślnej** zachowuje zwykłą grubość.
Grubość ustawiona, zanim pojawiła się ta opcja, jest grubością każdego progu,
jak dotąd.

### Sterowanie karuzeli, przyciski, kafelki do pobrania i karty obrazów: opcje wyglądu

Każda z poniższych opcji jest domyślnie nieustawiona, a strona zapisana przed
ich wprowadzeniem wygląda tak jak wcześniej.

**Sterowanie karuzeli** (karuzela, slider produktów i karuzela najnowszych
wpisów, w grupie **Sterowanie**):

| Opcja | Działanie |
| --- | --- |
| **Kolor ikony strzałki (styl wypełniony)** | Znak strzałki w stylu **Wypełniony** (także wypełnionej strzałki „dalej”), domyślnie biały — dzięki temu biała wypełniona strzałka może mieć czarną ikonę. Pokazywane, gdy któryś styl strzałek jest wypełniony. |
| **Ukryj strzałki na**, **Ukryj kropki na** | Punkty przerwania (telefon, tablet, desktop), na których strzałki albo kropki nie są pokazywane, np. strzałki dopiero od desktopu, a na telefonach i tabletach przesuwanie palcem. Rząd sterowania, w którym nic nie zostaje, jest wtedy usuwany i nie zostawia pustego miejsca. |

Kropki dopasowują się do schematu kolorów: w ciemnej sekcji bieżąca kropka ma
jasny kolor tekstu schematu na tle bladych kropek, więc nadal widać, która jest
bieżąca.

Strzałki umieszczone **W nagłówku sekcji** są widoczne także wtedy, gdy
karuzela nie ma nagłówka: nagłówek zawiera wtedy same strzałki, na swoim końcu,
tak jak obok nagłówka. **Położenie strzałek** karuzeli ma też opcję **W każdym
slajdzie z mediami i tekstem (pod tekstem)**: każdy **Slajd z mediami i tekstem** pokazuje
strzałki i kropki na końcu kolumny tekstu, a działające sterowanie ma tylko
slajd widoczny na ekranie (pozostałe są ukryte przed klawiaturą i czytnikami
ekranu). Jak inne położenia wybiera się je osobno dla każdego punktu
przerwania, np. pod slajdami na telefonie i pod tekstem od tabletu w górę.
Karuzela, której elementy nie są slajdami z mediami i tekstem, zachowuje wtedy
sterowanie pod slajdami. Slajdy z dowolną treścią (**Slajd**) nie mogą zawierać
sterowania.

**Przycisk pod produktami** slidera i siatki produktów ma **Wyrównanie
przycisku**: **Do lewej** (domyślnie), **Do środka** albo **Do prawej**.

**Przycisk** (`cms.Button`):

- Jego wypełnienie **Kontur** ma tło sekcji, tak jak zastąpiony nim przycisk
  `secondary`. **Przezroczyste wypełnienie konturu** pozwala zamiast tego
  prześwitywać tłu (dostępne przy wypełnieniu konturem).
- **Kolor obramowania** zastępuje kolor obramowania wypełnienia, np. szary
  pierścień wokół konturowego przycisku z samą ikoną. Przycisk **Tylko ikona
  (okrągły)** ma rozmiar swojej opcji **Rozmiar** (mały, średni albo duży, z
  wysokości przycisków marki).

**Kafelek do pobrania**: **Schemat kolorów karty** (jak sekcja, jasny,
stonowany albo ciemny), **Tło karty**, **Obramowanie karty** (domyślnie
włączone), **Zaokrąglone narożniki**, **Odstęp wewnętrzny karty** (stopień
skali odstępów), **Rozmiar tytułu** (stopień skali typografii albo **Własny
(px)**, dla każdego punktu przerwania) oraz **Pokaż typ pliku** (domyślnie
włączone). **Obraz po najechaniu** to domyślny **Delikatny odcień** albo **Cały
obraz z ciemnym gradientem**, na którym tekst staje się biały. **Wygląd
odnośnika** to domyślna **Etykieta tekstowa** albo 48-pikselowy **Okrągły
przycisk z ikoną** w prawym dolnym rogu, obramowany kolorem tekstu; etykietę
nadal odczytują czytniki ekranu. Przy okrągłym przycisku **Rozmiar przycisku z
ikoną** to **Mały** (48 px, jak dotąd), **Średni** (72 px) albo **Duży** (112 px),
a **Styl przycisku z ikoną** to **Kontur** (obwódka, jak dotąd) albo
**Wypełniony**: koło w kolorze tekstu z ikoną w kolorze tła karty. Cały kafelek pozostaje jednym odnośnikiem do
pobrania, a kafelki w jednym rzędzie karuzeli mają równą wysokość.

**Obraz karuzeli**: **Etykieta „Więcej”** (np. „Czytaj więcej”) pokazywana na
obrazie we własnym narożniku — **Położenie etykiety „Więcej”**, domyślnie na
dole po prawej — niezależnie od podpisu, z opcjonalną **Ikoną etykiety
„Więcej”**. Ma 14 px, jest półgruba, stoi 12 px od swojego narożnika, przyjmuje
kolor tekstu podpisu, gdy jest ustawiony, i należy do odnośnika elementu.

Podpis **Obrazu**: **Położenie podpisu** wybiera się dla każdego punktu
przerwania (np. pod obrazem na telefonach i obok niego od tabletu w górę), a
podpis ma **Rozmiar podpisu** (stopień skali typografii albo **Własny (px)**)
i **Wyrównanie podpisu** dla każdego punktu przerwania; zachowuje przygaszony
kolor tekstu schematu.

### Przyciski w blokach, teksty bloku Hero, kafelki do pobrania i podpisy obrazów: więcej opcji

Każda z poniższych opcji jest domyślnie nieustawiona, a strona zapisana przed
ich wprowadzeniem wygląda tak jak wcześniej.

**Przyciski wewnątrz bloków** — przyciski bloku Hero, karty czy panelu,
przycisk nagłówka sekcji lub listy, przyciski bloku Media i tekst — mają te
same opcje wyglądu co blok **Przycisk**: **Przezroczyste wypełnienie
konturu** i **Kolor obramowania**. Przycisk z samą ikoną może też być
**Pigułką** zamiast **Koła** (**Kształt przycisku z samą ikoną**), szeroką na
1,15 jego wysokości — np. przycisk „przewiń w dół” nieco szerszy niż wysoki.
Blok Przycisk też oferuje pigułkę; pozostałe opcje wyglądu zostają tam, gdzie
były.

**Hero**:

- **Wysokość linii tytułu** dla każdego punktu przerwania, przy własnym
  rozmiarze tytułu. **Kolor tekstu** bloku barwi wszystkie jego teksty;
  **Kolor nadtytułu** daje nadtytułowi własny akcent.
- Nadtytuł może służyć jako etykieta nad tekstem: **Rozmiar nadtytułu**
  (stopień skali typografii albo **Własny (px)**, dla każdego punktu
  przerwania, z **Wysokością linii nadtytułu** przy rozmiarze własnym) oraz
  **Nadtytuł wielkimi literami** (domyślnie włączone), wyłączone dla etykiety
  pisanej zwykłymi literami. Ustaw jego miejsce i odstęp po nim w **Elementy:
  kolejność i odstępy**, jak dla każdego elementu.
- Podpis **Dowodu społecznego**: **Położenie podpisu dowodu społecznego** obok
  obrazu (domyślnie) albo pod nim, dla każdego punktu przerwania — np. pod
  obrazem na telefonach i obok od tabletu w górę — oraz **Własna maksymalna
  szerokość podpisu dowodu społecznego (px)** dla każdego punktu przerwania.
  Zachowuje mały, przygaszony tekst.

**Kafelek do pobrania**:

- **Prowadzi do** pliku (domyślnie) albo **Strony lub adresu URL**: kafelek ma
  wtedy **Odnośnik** (stronę, produkt, kategorię, plik albo adres URL) zamiast
  pliku, nie pokazuje typu pliku, a jego okrągły przycisk z ikoną wskazuje
  dalej. Kafelek, którego odnośnik nigdzie nie prowadzi, nie jest pokazywany
  klientom; edytor pokazuje w jego miejscu ostrzeżenie.
- **Własna minimalna wysokość (px)**, jedna wartość dla każdego punktu
  przerwania (domyślnie 180 px).
- Własny rozmiar tytułu działa teraz także od tabletu w górę (wcześniej był
  odczytywany tylko na telefonach).

**Obraz karuzeli**: podpis przy tej samej krawędzi co etykieta „Więcej” — oba
na dole albo oba na górze — stoi teraz nad linią etykiety zamiast ją dzielić,
więc na wąskiej karcie nigdy się nie nakładają.

Podpis **Obrazu**: **Własna maksymalna szerokość podpisu (px)** dla każdego
punktu przerwania. Podpis
umieszczony pod obrazem na telefonach i obok niego od szerszego punktu
przerwania dostaje tam własną kolumnę obok obrazu o ustawionej szerokości,
zamiast być ściśnięty do szerokości obrazu.

Pusty nagłówek w tekście — blok Nagłówek, nagłówek bloku Media i tekst, tytuł
bloku Hero — nie zapisuje na stronie pustego elementu nagłówka; blok Nagłówek
zachowuje swoje odstępy.

### Zakładki: panel w kolumnach

Panel zakładki zawiera bloki, więc panel ułożony w kolumny to **Wiersz** (Row)
wstawiony do niego; osobny układ nie jest potrzebny. Na przykład panel z krótkim
tekstem po lewej, obrazem pośrodku i tekstem z przyciskiem po prawej:

1. Zaznacz blok Zakładki i otwórz kartę na pasku bocznym; upuść **Wiersz** w jej
   **Panelu** i wybierz **3 kolumny**.
2. Ustaw szerokość każdej **Kolumny** na karcie **Responsive**, na przykład 3, 5
   i 4 z 12 na komputerze i po 12 na telefonie, gdzie kolumny ułożą się jedna pod
   drugą.
3. Wypełnij kolumny: Nagłówek i Obraz z podpisem (linia z dowodem społecznym) w
   pierwszej, Obraz w drugiej, tekst Rich Content i Przycisk w trzeciej.

Panel przyjmuje każdy blok z wyjątkiem samej Kolumny (kolumny są w Wierszu),
kolejnego bloku Zakładki lub Akordeon oraz Sekcji. Każdy panel, razem z
kolumnami, jest w HTML wyświetlanym przez serwer. **Odstęp pod paskiem kart**
ustawia odległość między paskiem a panelem.

Na telefonie wiele kart zawija się do dwóch lub więcej wierszy. Ustaw
**Zakładki, które się nie mieszczą** na **Przewijaj w jednym wierszu**, aby
zostawić jeden wiersz, który odwiedzający przesuwa palcem w bok; pasek
przyciąga się do karty, karta wybrana strzałkami lub dotknięciem przewija się
do widoku, a nic szerszego niż ekran nie przesuwa strony w bok.

**Rozmiar kart** ustawia się dla każdego progu na karcie Responsive: na
przykład małe pigułki na telefonie i średnie od tabletu wzwyż. Z jednym
rozmiarem dla wszystkich progów karty wyglądają tak, jak z rozmiarem ustawionym
w wyglądzie paska kart.

**Tło karty po najechaniu** i **Tekst karty po najechaniu** (w wyglądzie paska
kart, kolor marki albo wartość hex) zmieniają kolor niewybranej karty, gdy
wskaźnik jest nad nią, z krótkim przejściem koloru; na ekranie dotykowym nic nie
zostaje po dotknięciu. Bez ustawienia karty nie zmieniają się po najechaniu, jak
dotąd.

**Zmiana panelu** jest domyślnie **Natychmiastowa**. **Przenikanie** płynnie
zamienia panele: wychodzący panel znika nad wchodzącym, a wysokość bloku
płynnie przechodzi od jednego panelu do drugiego. **Przesunięcie** dodaje
krótki ruch w bok w kierunku zmiany (karta położona dalej wjeżdża od strony
końca). Każdy panel pozostaje w HTML wyświetlanym przez serwer; dopóki
wychodzący panel znika, nie można na nim ustawić fokusu ani odczytać go
czytnikiem ekranu, a strzałki, Home i End działają tak jak przy zmianie
natychmiastowej. Odwiedzający, którzy ustawili w systemie ograniczenie ruchu,
widzą zmianę natychmiastową.

### Kolumny: rozmieszczenie i kolejność

Kolumna wyższa niż jej bloki (Wiersz rozciąga kolumny do wysokości najwyższej,
co jest jego domyślnym wyrównaniem w pionie) może je rozmieścić opcją
**Rozmieść bloki w pionie**:

| Opcja | Efekt |
| --- | --- |
| Od góry | Dotychczasowy stos, domyślnie. |
| Do środka | Bloki stoją razem pośrodku kolumny. |
| Do dołu | Bloki stoją razem na dole. |
| Równe odstępy | Pierwszy blok na górze, ostatni na dole, pozostałe rozłożone równo. |
| Ostatni blok na dole | Bloki układają się od góry, a ostatni trafia na dół, na przykład linia z dowodem społecznym pod tekstem. |

Blok w kolumnie może też zająć inne miejsce na danym rozmiarze ekranu, bez
drugiej kopii ukrytej przez **Hide on**: zaznacz blok i na karcie Responsive
ustaw **Kolejność w kolumnie** dla tego progu — **Pierwszy**, **Ostatni** albo
od **Pozycja 1** do **Pozycja 6** (bloki pozostawione **Jak ustawiono** stoją
przed numerowanymi). Próg bez własnej wartości przyjmuje wartość progu
niższego. Na przykład obraz z dowodem społecznym na początku kolumny na
komputerze i na końcu na telefonie: **Ostatni** na progu bazowym, **Pierwszy**
na komputerze.

Kolejność zmienia to, co odwiedzający **widzi**, a nie strukturę strony:
czytnik ekranu nadal czyta bloki, a klawisz Tab nadal przechodzi przez nie, w
kolejności, w jakiej są ułożone w edytorze. Zmieniaj kolejność tylko tam, gdzie
obie kolejności mają sens. Płótno edytora też zachowuje ułożoną kolejność, więc
przeciąganie bloków działa na tym, co pokazuje konspekt; opublikowana strona
pokazuje kolejność dla każdego progu. W kolumnie z ustawionym rozmieszczeniem
lub kolejnością bloki są układane jako kolumna flex, więc pionowe marginesy
dwóch sąsiednich bloków sumują się zamiast nakładać.

Tak samo w swoim Wierszu może przesunąć się cała kolumna: zaznacz **Kolumnę**
i na karcie Responsive ustaw **Kolejność w wierszu** dla danego progu, z tymi
samymi wyborami. Na przykład w Wierszu z dwiema kolumnami, które na telefonie
układają się jedna pod drugą, druga kolumna jako pierwsza na telefonie i na
swoim miejscu na komputerze: **Pierwszy** na progu bazowym, **Jak ustawiono**
na komputerze. Jak w przypadku bloków zmienia się tylko to, co odwiedzający
widzi — czytnik ekranu i klawisz Tab przechodzą przez kolumny w kolejności,
w jakiej są ułożone — a płótno edytora zachowuje ułożoną kolejność.

### Kolumny: miejsce w siatce wiersza

Wiersz układa swoje kolumny na siatce dwunastu ścieżek; szerokość (**Width**) mówi, ile
ścieżek zajmuje kolumna. Na karcie Responsive **Kolumnę** można też umieścić
na tej siatce dla każdego progu:

| Opcja | Wartości | Efekt |
| --- | --- | --- |
| **Wysokość w wierszach** | 1 wiersz (domyślnie) do 4 wierszy | Kolumna zajmuje tyle wierszy Wiersza, więc sąsiednie kolumny mogą układać się obok niej jedna pod drugą. |
| **Początek w kolumnie** | Następne wolne miejsce (domyślnie), 1 do 12 | Ścieżka, w której zaczyna się kolumna. Początek, który przy szerokości kolumny na danym progu wypchnąłby ją poza dwunastą ścieżkę, jest przesuwany w lewo, tak aby kolumna się zmieściła. |
| **Początek w wierszu** | Następne wolne miejsce (domyślnie), 1 do 4 | Wiersz, w którym zaczyna się kolumna. |

Próg bez własnej wartości przejmuje wartość progu poniżej. Gdy tylko jedna
kolumna Wiersza ma ustawione miejsce, ten Wiersz wypełnia wolne miejsca swojej
siatki po kolei (gęste upakowanie), więc kolumna, która ma tylko początek
w kolumnie, trafia do pierwszego wolnego wiersza tej ścieżki. Kolumna, która na
każdym progu ma jeden wiersz i następne wolne miejsce, wygląda dokładnie tak jak
wcześniej.

Na przykład boczna kolumna z krótkim elementem na dole obok dwóch wysokich
kolumn, które na telefonie układają się jedna pod drugą. Dodaj cztery kolumny,
każdą o szerokości (**Width**) 12 na progu bazowym i 4 na komputerze, w kolejności,
w jakiej mają być czytane: **A** (góra bocznej kolumny), **B**, **C** i **D**
(element pod A). Następnie tylko na komputerze ustaw **Wysokość w wierszach**
na 2 wiersze w B i C oraz **Początek w kolumnie** 1 (opcjonalnie **Początek
w wierszu** 2) w D. Na komputerze A i D dzielą pierwszą ścieżkę, a B i C zajmują
oba wiersze; na telefonie A, B, C i D układają się w tej kolejności. D istnieje
raz: żadna druga kopia nie jest ukrywana na wybranym progu.

Tak jak kolejność, miejsce w siatce zmienia to, co odwiedzający **widzi**, a nie
strukturę strony: czytnik ekranu i klawisz Tab przechodzą przez kolumny
w kolejności, w jakiej są ułożone w edytorze, więc ułóż je w kolejności, która
też dobrze się czyta. Płótno edytora zachowuje ułożoną kolejność i szerokości,
bez miejsca w siatce, więc przeciąganie kolumn działa na tym, co pokazuje
konspekt; opublikowana strona pokazuje miejsce w siatce dla każdego progu.

### Kolumny: tło szersze niż kolumna

**Wysunięcie tła poza treść (px)** kolumny, na karcie **Responsive**, sprawia, że
jej ramka — tło, obramowanie i cień — sięga o tyle pikseli poza kolumnę
z każdej strony, a treść kolumny zostaje na miejscu: np. szara ramka nieco
szersza niż kolumna tekstu obok. Ustaw je dla każdego progu, np. **0** na
telefonie, gdzie kolumna i tak zajmuje cały ekran, i **24** od komputera.
Przy 0 (domyślnie) ramka jest tak szeroka jak kolumna. Wysunięcie sięga
w odstęp między kolumnami i poza krawędź wiersza, więc nie przekraczaj miejsca
wokół kolumny. Boczny **Odstęp zewnętrzny** ramki kolumny nadal działa,
dodawany do wysunięcia, na każdym progu — próg z wysunięciem 0 pokazuje ramkę
z jej własnymi marginesami.

### Obrazy mobilne: tylko telefony albo telefony i tablety

Obraz z **obrazem mobilnym** — blok **Obraz**, Hero, Media i tekst, każdy blok,
którego pole obrazu go oferuje — pokazuje obraz mobilny na telefonach, a obraz
główny od szerokości tabletu (768 px). **Gdzie wyświetlać obraz na telefony**
(widoczne po ustawieniu obrazu mobilnego) przesuwa tę granicę do szerokości
komputera: **Telefony i tablety (poniżej 1024 px)** zostawia obraz mobilny
także na tabletach, np. dla wysokiego kadru, który pasuje do tabletu lepiej
niż szeroki kadr na komputer. Tło sekcji i grupy sekcji ma to samo
ustawienie, **Gdzie wyświetlać obraz lub wideo na telefony**, dla obrazu lub
wideo mobilnego. Przy **Telefony (poniżej 768 px)** nic nie jest zapisywane,
a obraz przełącza się jak dotąd.

### Slajdy z mediami i tekstem, sterowanie karuzeli i odstępy w blokach

Każda z poniższych opcji jest domyślnie pusta lub wyłączona, a strona zapisana
wcześniej wygląda jak dotąd. Opcje oznaczone *dla każdego progu* ustawia się
na karcie **Responsive**; próg bez własnej wartości przyjmuje wartość progu
niższego, a próg, do którego nie sięga żadna wartość, zachowuje wygląd bloku.

**Slajd z mediami i tekstem**:

- **Obok siebie od** tabletu (768 px, domyślnie) albo komputera (1024 px);
  poniżej media i tekst są jeden pod drugim, media pierwsze.
- **Układ (media – tekst)** na 12 kolumnach od szerokości „obok siebie” w
  górę (zob. *Układy na 12 kolumnach*); **Domyślny** zostawia dwie równe
  połowy.
- **Zaokrąglone narożniki** mediów (domyślnie 8 px; **Brak** dla prostych).
- **Rozmiar tytułu** i **Rozmiar tekstu**, *dla każdego progu*, każdy z
  wysokością linii przy rozmiarze własnym, oraz **Grubość tytułu** i
  **Grubość tekstu**.
- **Wcięcie wiszące za ikoną na początku**: tytuł zaczynający się od ikony
  (np. znaku zaznaczenia) wisi obok niej, więc zawinięty wiersz zaczyna się pod
  tekstem.

**Sterowanie karuzeli** (Karuzela, karuzela produktów i karuzela najnowszych
wpisów):

- **Wyrównanie przycisków** oferuje też **Kropki na początku, strzałki na
  końcu**. Wybrane wyrównanie dotyczy także sterowania wewnątrz slajdu z
  mediami i tekstem (bez wyboru zaczyna się ono przy lewej krawędzi tekstu).
- **Zostaw strzałki, gdy mieszczą się wszystkie slajdy** (w **Sterowaniu**):
  gdy wszystkie slajdy są już na ekranie, strzałki zostają, obie nieaktywne, a
  kropki są ukryte; wyłączone — sterowanie znika jak dotąd. Zostawione
  strzałki nie są przygaszone: leżą na tle schematu kolorów, z jego obramowaniem
  i stonowanym kolorem tekstu, więc pozostają czytelne w jasnej, stonowanej i
  ciemnej sekcji oraz na slajdzie. Wybrany **Wygląd nieaktywnej strzałki** —
  **Jasny obrys** albo **Kolor** — ma pierwszeństwo i jest dostępny w tym
  przypadku również w zapętlonej karuzeli.

**Media i tekst**: **Rozmiar tekstu** dla tekstu każdego wiersza, *dla
każdego progu*, z **Wysokością linii tekstu** przy rozmiarze własnym; **Odstęp
między nagłówkiem a akapitami** i **Odstęp między mediami a tekstem jeden pod
drugim**, każdy jako stopień skali odstępów. Każdy z **Kolejnych wierszy** ma własne
**Wyrównanie w pionie**; **Jak w całym bloku** (albo puste) przyjmuje
wyrównanie bloku.

**Panel z obrazem w tle**: **Układ na urządzeniach mobilnych** — **Obraz i
tekst jeden pod drugim** (domyślnie) albo **Tekst na obrazie**, który
zachowuje własną wysokość obrazu mobilnego (wysoki kadr zachowuje kształt), a
tekst kładzie u jego góry lub dołu, według **Tekstu na urządzeniach
mobilnych**.

**Lista funkcji**: **Odstęp między wierszami (px)**, *dla każdego progu*,
niezależnie od odstępu, który wtedy rozdziela tylko kolumny; **Wysokość linii
list w tekście**, *dla każdego progu*, przy własnym rozmiarze tekstu.

**Karta wezwania do działania**: **Odstęp wewnętrzny karty**, stopień skali
odstępów (od niego mierzone jest odsunięcie obrazu), a z obrazem **Układ
(obraz – tekst)** od tabletu w górę (domyślnie połowa karty; zob. *Układy na 12
kolumnach*).

**Statystyki**: **Wysokość linii etykiety**, *dla każdego progu*, przy własnym
rozmiarze etykiety.

**Lista odnośników**: **Linia pod ostatnim wierszem**, dostępna, gdy
**Linia między wierszami** jest włączona.

### Progi układu obok siebie, układy kolumn i więcej opcji tekstu

Jak wyżej: każda z poniższych opcji jest domyślnie pusta, strona zapisana
wcześniej wygląda jak dotąd, a opcje oznaczone *dla każdego progu* ustawia się
na karcie **Responsive**.

**Hero**: podpis dowodu społecznego umieszczony **Pod obrazem** zawsze
zaczyna się w nowym wierszu, także z **Własną maksymalną szerokością podpisu
dowodu społecznego (px)** na tyle wąską, że zmieściłby się obok obrazu.

**Media i tekst**:

- Z **Układem zaawansowanym (kolumny z 12)** — **Szerokość mediów** i
  **Szerokość tekstu** w kolumnach z 12 oraz **Kolumny między mediami a
  tekstem**, od szerokości „obok siebie” w górę — jak w slajdzie z mediami i
  tekstem. Ustawienie którejkolwiek układa każdy wiersz na siatce 12 kolumn
  (media 6 kolumn i brak odstępu, o ile nie ustawiono, tekst resztę), w
  lustrzanym odbiciu w wierszu z mediami po prawej, zamiast **Podziału (media –
  tekst)**; np. po 5 kolumn w odstępie jednej kolumny.
- **Wysokość linii nagłówka** (przy własnym rozmiarze nagłówka, *dla każdego
  progu*), **Grubość tekstu** oraz **Kolor znaczników listy** list ze znakiem
  zaznaczenia i strzałką w tekście każdego wiersza.

**Karta wezwania do działania** (z obrazem):

- **Położenie obrazu, gdy jeden pod drugim**: **Nad tekstem** (domyślnie) albo
  **Pod tekstem**; odsunięcie obrazu biegnie wtedy wzdłuż boków i dołu.
- **Obok siebie od** tabletu (768 px, domyślnie) albo komputera (1024 px);
  poniżej karta układa się jak na telefonie.
- **Własne odsunięcie obrazu (px)** to jedna wartość dla każdego progu.
- **Rozmiar tekstu**, *dla każdego progu*, z rozmiarem własnym (px); lista za
  nim podąża.

**Statystyki** (z obrazem): **Obok siebie od** tabletu (domyślnie) albo
komputera; poniżej obraz stoi nad liczbami.

**Slajd z mediami i tekstem**:

- **Wcięcie tekstu**, dostępne przy włączonym wcięciu wiszącym: **Wyrównane do
  tekstu tytułu** zaczyna tekst poniżej tam, gdzie zaczyna się tekst tytułu, za
  ikoną na początku i jej odstępem. Wcięty jest tylko tekst pod tytułem
  zaczynającym się od ikony.
- **Odstęp między mediami a tekstem jeden pod drugim** oraz **Odstęp między
  tytułem, tekstem a sterowaniem** (sterowaniem, które karuzela umieszcza w
  slajdach), każdy jako stopień skali odstępów.

**Obraz**: z obrazem mobilnym — **Gdzie wyświetlać obraz na telefony**: tylko
telefony (poniżej 768 px, domyślnie) albo telefony i tablety (poniżej
1024 px), jak w polach obrazu.

**Nagłówek**: **Maksymalna szerokość tekstu**, *dla każdego progu* — nazwana
miara albo szerokość własna (px); nagłówek wyśrodkowany lub wyrównany do
prawej zachowuje wyrównanie.

**Treść sformatowana**: **Wysokość linii list**, *dla każdego progu*, przy
własnym rozmiarze tekstu.

**Akordeon**: **Wysokość linii tytułu**, *dla każdego progu*, przy własnym
rozmiarze tytułu.

**Siatka produktów** i **Slider produktów**: **Rozmiar wprowadzenia** nagłówka
(token typografii albo własny w px, *dla każdego progu*), **Grubość
wprowadzenia** i **Kolor wprowadzenia**.

**Kafelek do pobrania**: **Grubość tytułu**.

### Rozmiary tekstu dla każdego progu

Tekst, którego rozmiar jest innym tokenem typografii w każdym progu — np.
nagłówek karuzeli w Nagłówku 3 na telefonie i w Nagłówku 2 na komputerze, tytuł
hero, nagłówek sekcji albo blok Nagłówek — bierze teraz w każdym progu także
wysokość linii, grubość i odstęp między literami z tokenu tego progu (do
2026-10-28 zostawały te z pierwszego progu). Grubość ustawiona w samym bloku
nadal wygrywa; wysokość linii działa tylko na progu z rozmiarem Własny (px).

### Odstępy kolumn, wyrównanie par kolumn, wyrównanie w wierszu i więcej opcji

Jak wyżej: każda opcja poniżej jest domyślnie pusta, strona zapisana przed nimi
wygląda jak dotąd, a opcje oznaczone *dla każdego progu* ustawia się na karcie
**Responsive**.

**Kolumny z 12** — w blokach **Media i tekst**, **Slajd z mediami i tekstem**
oraz **Statystyki** (z obrazem), gdy wybrany jest układ na 12 kolumnach:

- **Odstęp między kolumnami (px)**, *dla każdego progu*. Puste pole zostawia,
  jak dotąd, boczny margines strony; ustaw wartość (np. 16 px), aby kolumny
  zostały tam, gdzie je umieszczasz, niezależnie od marginesu.
- **Wyrównanie kolumn do** (**Media i tekst** i slajd z mediami i tekstem, z
  **Układem zaawansowanym (kolumny z 12)**): **Strona mediów** (domyślnie)
  kończy wiersz z mediami po prawej na kolumnie
  12 — np. tekst w kolumnach 2–6, a media w 8–12. **Początek (kolumna 1)**
  zaczyna parę od kolumny 1 po obu stronach — tekst 1–5, media 7–11 — a
  **Koniec (kolumna 12)** kończy ją na kolumnie 12.

**Wiersz**: **Wyrównanie kolumn** (do góry, do środka, do dołu) ustawia teraz
kolumny na opublikowanej stronie tak jak w edytorze; do 2026-10-28 każda kolumna
rozciągała się na wysokość wiersza niezależnie od wyboru. Wiersz z ustawieniem
**Rozciągnij** (domyślnym) wygląda jak dotąd. Wiersz zapisany z wartością
`center` — słowem, którego **Media i tekst** używa dla tego samego wyboru — jest
czytany jako wyrównanie do środka.

**Karta wezwania do działania**:

- **Obok siebie od: Komputera (1024 px)** zostawia teraz listę dwukolumnową
  w jednej kolumnie także na tablecie, dopóki karta jest ułożona w pionie; karta
  obok siebie od tabletu ma dwie kolumny od 768 px.
- **Odstęp pod nagłówkiem**, stopień skali odstępów (domyślnie 16 px).
- **Grubość tekstu** oraz **Maksymalna szerokość tekstu** (nazwana miara albo
  Własna (px), *dla każdego progu*) dla tekstu karty.

**Statystyki**: **Wysokość linii wartości**, *dla każdego progu*, przy własnym
rozmiarze wartości. Próg poniżej pierwszego progu z rozmiarem własnym zachowuje
wysokość linii rozmiaru wartości.

**Media i tekst**: **Rozmiar tekstu elementu** (token typografii albo Własny
(px), *dla każdego progu*) i **Grubość tekstu elementu** dla tekstu każdego
elementu (domyślnie 15 px i przygaszony).

**Treść sformatowana**: **Grubość tekstu**; listy za nią podążają.

**Lista funkcji**:

- **Położenie ikony** ustawia się *dla każdego progu* — np. obok tytułu na
  tablecie i nad nim od 1024 px. Jedno położenie zapisane wcześniej obowiązuje
  w każdym progu.
- **Szerokość na komputerach (kolumny z 12)** elementu: od 1024 px lista jest
  układana na 12 kolumnach, ten element zajmuje swoją szerokość, a pozostałe
  swój udział w **Kolumnach** (np. 6 z 12 przy dwóch kolumnach).
- **Grubość tytułu** już wcześniej ustawiała się dla każdego progu.

**Karuzela**, **Slider produktów**, **Siatka produktów** i **Najnowsze wpisy**:
**Wysokość linii nagłówka** w nagłówku bloku, *dla każdego progu*, przy
własnym rozmiarze nagłówka; próg poniżej pierwszego progu z rozmiarem własnym
zachowuje wysokość linii rozmiaru nagłówka. **Najnowsze wpisy** mają też
**Grubość wprowadzenia**.

**Lista odnośników**: **Wysokość linii tytułu wiersza**, *dla każdego progu*,
przy własnym rozmiarze tytułu wiersza.

**Zapis do newslettera**: **Ikona przycisku** z katalogu ikon za tekstem
przycisku (domyślnie brak).

**Opinia**: **Rozmiar cytatu** — token typografii albo Własny (px), *dla
każdego progu* (domyślnie 1,15 rem).

**Kafelek do pobrania** (z okrągłym przyciskiem z ikoną): **Ikona przycisku
z ikoną**, znak z katalogu ikon — np. dodane do katalogu pobieranie z chmury;
puste pole zostawia strzałkę pobierania dla pliku i strzałkę dalej dla
odnośnika.

### Marginesy i wypełnienie ramki dla każdego progu

**Odstęp zewnętrzny** (margines) i **Odstęp wewnętrzny** (wypełnienie) każdego
bloku, który je ma, ustawia się dla każdego progu na karcie **Responsive**:
w **Scope settings** wybierz Base (telefon), Tablet albo Desktop i wpisz
wartości dla tego progu, np. 16 px pod nagłówkiem na telefonie i 32 px na
komputerze. Próg bez własnej wartości przyjmuje wartość progu niższego.

### Przyciski na pełną szerokość i „czytaj więcej” jako strzałka

- **Przyciski na pełną szerokość.** Blok **Przycisk** ma na karcie **Responsive** opcję
  **Szerokość**: **Dopasowana do etykiety** (domyślnie) albo **Pełna szerokość**, która rozciąga
  przycisk na całe pole. Można ją ustawić osobno dla każdego rozmiaru ekranu, na przykład pełna
  szerokość na telefonach i dopasowana od tabletu w górę. Bloki z listą przycisków — **Hero**,
  **Media i tekst**, **Karta wezwania do działania**, **Panel z obrazem w tle** oraz **Slajd z mediami i
  tekstem** — mają opcję **Szerokość przycisków** dla całej listy: przy **Pełnej
  szerokości** przyciski układają się jeden pod drugim, każdy na całą szerokość. Bez ustawienia
  przyciski wyglądają jak dotąd.
- **„Czytaj więcej” jako strzałka.** W tekście sformatowanym ustaw kursor we fragmencie „czytaj
  więcej” i naciśnij na pasku narzędzi **Read more as a chevron** (⌄). Fragment otwiera się wtedy
  samą strzałką zamiast wiersza podsumowania, a strzałka obraca się po otwarciu. Tekst
  podsumowania pozostaje nazwą tego przycisku dla czytników ekranu, więc powinien coś mówić
  („Pokaż szczegóły”). W edytorze podsumowanie jest nadal widoczne i można je edytować. Ponowne
  naciśnięcie przywraca podsumowanie tekstowe.

### Położenie „czytaj więcej”, wygląd akordeonu i kolory wyróżnień

- **Gdzie stoi „czytaj więcej”.** Gdy kursor jest we fragmencie „czytaj więcej”, pole
  **Położenie „czytaj więcej”** na pasku narzędzi tekstu sformatowanego ustawia jego
  podsumowanie — tekst albo strzałkę — na **Początku** wiersza (domyślnie), na **Środku** albo
  na **Końcu**. **Pokazuj rozwinięty tekst nad przyciskiem** (⤒) sprawia, że fragment otwiera
  się w górę: gdy jest otwarty, jego tekst wyświetla się nad podsumowaniem, które pozostaje
  jedynym przyciskiem pod nim. Zmienia się tylko kolejność na ekranie: użytkownicy klawiatury i
  czytników ekranu nadal trafiają najpierw na podsumowanie, jak dotąd. Przeglądarka, która nie
  potrafi zmienić kolejności we fragmencie „czytaj więcej”, pokazuje tekst pod podsumowaniem. W
  edytorze tekst zostaje pod podsumowaniem, żeby można go było edytować, a strzałka przed
  podsumowaniem oznacza taki fragment.
- **Wygląd akordeonu.** Blok **Akordeon** ma opcję **Ikona** — **Plus i minus** (domyślnie)
  albo **Strzałka (szewron)**, która obraca się po otwarciu elementu i stoi na końcu wiersza
  tytułu —, **Elementy** — **Zwykłe**, **W ramkach** (każdy element w obramowanym polu, z
  tytułem i panelem odsuniętymi od krawędzi; bez ustawienia decyduje, jak dotąd, **Styl**:
  *Z obramowaniem* oznacza ramki) albo **Wypełnione** (każdy tytuł na delikatnie
  zabarwionym pasku wziętym ze schematu kolorów — lekko ciemnym w jasnych schematach,
  lekko jasnym w ciemnym — z panelem odsuniętym pod nim, elementami co 8 px i bez linii
  podziału) —, **Linie podziału** dla zwykłych elementów — **Brak**,
  **Między elementami** albo **Nad, między i pod elementami** (bez ustawienia **Styl** rysuje
  swoją zwykłą linię pod każdym elementem) — oraz **Odstęp nad i pod tytułem** na karcie
  **Responsive**: rozmiar odstępu albo wartość **Własny (px)** dla każdego progu (12 px bez
  ustawienia). Każdy panel nadal jest w kodzie HTML strony, a zamknięte panele są ukryte do
  czasu otwarcia.
- **Kolor tytułu, linia podziału i rozmiar ikony akordeonu.** **Kolor tytułu** (kolor marki
  albo wartość hex) barwi tytuł każdego elementu i jego ikonę; pozostawiony pusty — mają kolor
  tekstu. **Położenie linii podziału** rysuje linię elementu, który ją ma, **Pod elementem**
  (domyślnie) albo **Pod tytułem**, tak że otwarty element pokazuje linię między tytułem a
  panelem; przy **Między elementami** ostatni tytuł nie ma linii, a elementy w ramkach się nie
  zmieniają. **Rozmiar ikony** to **Mała (16 px)**, **Średnia (20 px)**, **Duża (24 px)** albo
  wartość **Własny (px)**; bez ustawienia ikona, jak dotąd, ma rozmiar tekstu tytułu.
- **Odstępy i grubość tytułu akordeonu.** Na karcie **Responsive** opcja **Odstęp nad
  rozwiniętym panelem** ustawia odstęp między tytułem elementu (albo jego linią, gdy linia jest
  pod tytułem) a otwartym panelem, a **Odstęp między elementami** — odstęp od jednego elementu
  do następnego; każdy to rozmiar odstępu albo wartość **Własny (px)** dla każdego progu. Próg
  bez ustawienia zachowuje zwykłe odstępy: brak odstępu nad panelem (12 px pod linią tytułu),
  brak odstępu między zwykłymi elementami, 8 px między elementami w ramkach lub wypełnionymi. **Odstęp pod
  rozwiniętym panelem** ustawia odstęp pod treścią otwartego panelu (bez ustawienia 12 px), a
  **Odstęp po rozwiniętym elemencie** — odstęp od otwartego elementu do następnego tytułu,
  używany zamiast **Odstępu między elementami**, dopóki element jest otwarty (próg bez
  ustawienia korzysta z odstępu między elementami); oba to rozmiar odstępu albo wartość
  **Własny (px)** dla każdego progu i otwierają się oraz zamykają razem z panelem. **Grubość
  tytułu** ustawia, jak gruby jest każdy tytuł — **Domyślna** (zwykła półgruba) albo grubość
  od **Cienka (300)** do **Bardzo gruba (800)** — jedną dla wszystkich szerokości albo, na
  karcie **Responsive**, osobno dla każdego progu; próg poniżej pierwszego z ustawioną
  grubością zachowuje zwykłą grubość.
- **Otwieranie i zamykanie z animacją.** Fragment „czytaj więcej” i element akordeonu otwierają
  się i zamykają z krótką animacją wysokości. Odwiedzający, którzy w systemie poprosili o
  ograniczenie ruchu, widzą je otwarte od razu; tak samo przeglądarki, które nie potrafią
  animować do wysokości treści. Element akordeonu otwarty przy wczytaniu strony nie wjeżdża z
  animacją.
- **Kolory wyróżnień.** W nagłówku, tytule bloku albo podpisie zaznacz frazę i wybierz na pasku
  narzędzi tekstu **Kolor wyróżnienia**. Wybierz jeden z **Kolorów marki** — fraza idzie wtedy
  za kolorem z ekranu marki — albo wpisz lub wybierz **Własny kolor (hex)** i naciśnij
  **Zastosuj**. Fraza zachowuje swój styl wyróżnienia (akcent, wyciszony albo gradient; akcent,
  jeśli nie miała żadnego) i ma wybrany kolor; fraza z gradientem staje się jednolitym tekstem
  w tym kolorze. **Usuń kolor** zdejmuje kolor i zostawia wyróżnienie. Wybierz kolor, przy
  którym tekst pozostaje czytelny na swoim tle. Przetłumaczony nagłówek zachowuje wyróżnienie
  i jego kolor na przetłumaczonych słowach.

### Panel ustawień

Ustawienia każdego bloku są ułożone według tych samych zasad, więc dane
ustawienie wygląda i działa tak samo, gdziekolwiek się pojawia:

- **Kolejność.** Najpierw treść, potem układ, wygląd, odstępy i obramowanie,
  na końcu **Ukryj na**. **Grubość** tekstu stoi obok jego **rozmiaru**, obie
  na karcie **Responsive**, i ustawia się ją dla każdego progu jak rozmiar
  (grubość zapisana jako jedna wartość nadal obowiązuje na każdej szerokości).
- **Widać tylko to, co działa.** Na przykład odstęp między przewinięciami tylko
  przy włączonym **Autoodtwarzaniu**, wygląd strzałek tylko przy włączonym
  **Pokaż strzałki**, położenie sterowania tylko wtedy, gdy widać strzałki lub
  kropki, wygląd nieaktywnej strzałki tylko w karuzeli, która się nie zapętla,
  wygląd podpisu obrazu karuzeli dopiero, gdy ma podpis, strona obrazu tylko
  z obrazem, **Położenie w pionie** wiersza tylko przy **Minimalnej wysokości**,
  **Położenie linii** tylko tam, gdzie elementy akordeonu mają linie, a
  **Wycisz** tylko dla wideo, które nie odtwarza się samo (plik wideo
  odtwarzany automatycznie zawsze jest wyciszony).
- **Jeden przełącznik dla każdego ustawienia tak/nie** zamiast wyboru Tak/Nie;
  zapisuje te same wartości, więc zapisane strony się nie zmieniają.
- **Wyrównanie dla każdego progu** w ikonach, linkach do serwisów
  społecznościowych, pasku logotypów, liście cech, statystykach, haśle, banerze
  hero i zakładkach; wszędzie brzmi **Do lewej / Do środka / Do prawej** (strona
  — **Z lewej / Z prawej**). Wartość zapisana wcześniej obowiązuje na każdej
  szerokości.
- **Odstępy** to stopień skali odstępów albo **Własny odstęp (px)**, dla
  każdego progu — także w linkach do serwisów, pasku logotypów, siatce
  produktów i siatce kategorii; odstęp zapisany jako liczba pikseli otwiera się
  jako własny z tą liczbą i wygląda jak dotąd.
- **Własne wartości w pikselach** brzmią „Własny … (px)”, a każda własna
  maksymalna szerokość przyjmuje 160–2000 px.
- **Zaokrąglone narożniki** to nazwa każdego ustawienia narożników; blok, który
  ma dwa takie ustawienia, nazywa każde z nich (**Obraz – zaokrąglone
  narożniki**, **Podpis – zaokrąglone narożniki**).
- **Obrazy i wideo** podają najpierw **Bibliotekę zasobów**, a nowy obraz
  zaczyna od niej. Obraz zapisany bez źródła, z adresem URL, zachowuje ten adres.
- **Linki** obrazu, ikony, paska logotypów, paska ogłoszeń i znaczników mapy są
  takie same jak link przycisku: strona, produkt, kategoria, plik, sekcja tej
  strony albo adres URL, z **Otwórz w nowej karcie** (widocznym, gdy link już
  dokądś prowadzi). Adres URL zapisany wcześniej działa jak link typu URL z tym
  samym celem i wygląda jak dotąd; edytor przenosi go do nowego linku przy
  otwarciu bloku. Każdy adres URL, tu i w linkach do serwisów, musi zaczynać się
  od `https://`, `http://`, `mailto:`, `tel:` albo `/`, jak w każdym innym
  linku: inny adres (na przykład `javascript:`) wyświetla obraz, ikonę, logotyp
  lub tekst bez linku, a link do serwisu bez jego adresu.
- **Element otwarty na początku** (akordeon) i **Karta widoczna na początku**
  (zakładki) wybiera się spośród tytułów elementów zamiast wpisywać numer.
- **Nowe bloki przyjmują kolory sekcji**: nowy tekst, nowe ikony i linki do
  serwisów przyjmują kolor tekstu sekcji, a nowy pasek ogłoszeń — kolor
  podstawowy marki. Bloki, które już są na stronie, zachowują swoje kolory.
  **Kolor** ikon i linków do serwisów pokazuje wtedy **Dziedziczony (kolor
  tekstu)**; wybranie koloru go ustawia, a **Dziedzicz** wraca do koloru tekstu.
- **Ustawienia są przetłumaczone** na język panelu, także ustawienia wspólne dla
  wszystkich bloków (nazwa, **Ukryj na**, odstępy, obramowanie, tło, narożniki,
  cień, typografia), tłumaczone raz dla wszystkich bloków.

### Ruch

Ruch jest opcjonalny i oszczędny:

- **Animacja wejścia** sekcji (brak albo fade-up) oraz animacja na poziomie
  bloku w hero i haśle (brak, fade-up albo słowa pojawiające się po kolei);
  każdą można ograniczyć do komputera.
- **Powiększenie po najechaniu** na obrazach karuzeli, slajdach z mediami i
  tekstem oraz kafelkach z linkiem.
- Automatyczne przewijanie karuzeli jest wyłączone, dopóki się go nie włączy,
  zatrzymuje się po najechaniu i przy fokusie i ma przycisk pauzy.

Nic się nie porusza, gdy odwiedzający woli ograniczony ruch, a każdy tekst jest
w HTML wyświetlanym przez serwer i widoczny, zanim uruchomi się jakikolwiek
skrypt: ukryty stan początkowy nakłada skrypt dopiero po wczytaniu strony, a
treści już widocznej na ekranie nie rusza. Jedyny wyjątek, nad którym strona nie
panuje, to animowany SVG wybrany jako dekoracyjne tło schematu ciemnego:
zatrzymuje się przy ograniczonym ruchu tylko wtedy, gdy sam SVG tak stanowi
(zob. [Dekoracyjne tło](./brand.md#dekoracyjne-tło)).

### Rozmiary podglądu

Ramki podglądu Puck dla telefonu, tabletu i komputera mają logiczne szerokości **360 / tabletMin /
max(desktopMin, 1280)**. Powiększenie to wbudowane w Puck `transform: scale` wewnątrz iframe
(`waitForStyles: true`). Sprawdzając ustawienia responsywne, korzystaj z przełącznika rozmiaru
podglądu zamiast zmieniać rozmiar okna przeglądarki — reguły CSS `@media` zależą od szerokości iframe,
a skrypty warstwy edycji korzystają z wybranej szerokości podglądu.

Drzewo treści jest zapisywane w strukturze JSONB:

```jsonc
{
  "schema_version": 1,
  "languages": {
    "pl-PL": { /* Puck Data tree */ },
    "en-US": { /* Puck Data tree */ }
  }
}
```

`schema_version` jest zwiększane tylko wtedy, gdy zmienia się sposób zapisu węzła. Mechanizm
`content-schema-upgrader` przy starcie przechodzi przez każde zapisane drzewo i przepisuje węzły na
miejscu; obecne komponenty zaczynają od `schema_version=1`.

## Tłumaczenie treści przez AI

Page Builder potrafi przetłumaczyć maszynowo zawartość na język edytowanej
zakładki, za pomocą modelu językowego wybranego przez operatora. Funkcja jest
**domyślnie wyłączona**.

**Konfiguracja.** W **Ustawienia → Page Builder**:

| Ustawienie | Znaczenie |
| --- | --- |
| `cms.page_builder.translation.enabled` | Pokazuje przycisk **Przetłumacz**. Domyślnie wyłączone. |
| `cms.page_builder.translation.llm_credentials` | Konfiguracja LLM z ekranu **Poświadczenia**, której dostawcy, modelu i klucza API używa przycisk. Obsługiwani są OpenAI, Anthropic, Google, DeepSeek oraz dowolny punkt końcowy zgodny z OpenAI (przez Base URL konfiguracji). |
| `cms.page_builder.translation.max_source_characters` | Największa liczba znaków tekstu, jaką może wysłać jedno kliknięcie — domyślnie 40 000, dozwolone 1 000–200 000. Wyższy limit pozwala tłumaczyć dłuższe strony naraz, ale zwiększa koszt kliknięcia i wydłuża oczekiwanie na jedno żądanie, które wolny dostawca albo limit czasu serwera pośredniczącego może przerwać. |

Wszystkie trzy obowiązują na całej platformie i działają od następnego
kliknięcia, bez restartu. Paleta poleceń (⌘K / CTRL+K → „tłumaczenie”) otwiera
ekran Ustawień. Aby widzieć przycisk, rola potrzebuje uprawnienia
**Tłumaczenie treści Page Buildera przez AI** (`cms.translate`); do edycji
treści nadal potrzebne jest uprawnienie zapisu tej treści.

**Co opuszcza platformę.** Do dostawcy wybranego modelu trafiają wyłącznie
teksty z zawartości — nagłówki, akapity, etykiety przycisków, elementy list,
teksty alternatywne itd. Linki, odwołania do produktów i kategorii, kody
bloków, kolory, własny HTML i skrypty, nazwy bloków widoczne tylko w edytorze
oraz pola SEO nie są nigdy wysyłane ani zmieniane. Formatowanie w tekście
sformatowanym przechodzi jako numerowane znaczniki, a zmienne takie jak
`{{customer.firstName}}` są sprawdzane po powrocie; tekst, którego odpowiedź
gubi jedno albo drugie, zachowuje pierwotne brzmienie.

**Użycie.** Przycisk znajduje się na pasku narzędzi Page Buildera obok
**Kopiuj z języka** i mówi, co przetłumaczy:

- **Przetłumacz całą treść** — nic nie jest zaznaczone. Domyślnie tłumaczona
  jest zawartość bieżącej zakładki, a jej język jest wykrywany automatycznie;
  w oknie można zamiast tego wybrać jako źródło inną zakładkę językową (razem z
  jej niezapisanymi zmianami), która zastąpi zawartość tej zakładki.
- **Przetłumacz komponent** — zaznaczony jest blok: ten blok i wszystkie bloki
  zagnieżdżone w nim. Blok bez tekstu do przetłumaczenia wyłącza przycisk.
- **Przetłumacz zaznaczenie** — zaznaczony jest tekst w polu tekstowym lub
  sformatowanym: tylko te słowa. Zaznaczenie obejmujące różne formatowanie
  (np. częściowo pogrubione) albo kilka akapitów jest tłumaczone całymi
  akapitami, o czym informuje komunikat.

Wynik zastępuje zawartość jako **niezapisana zmiana**: można go przeczytać,
poprawić i zapisać jak zwykle albo kliknąć w komunikacie **Przywróć poprzednią
treść**, dostępne do następnego zapisu, tłumaczenia lub zmiany zakładki.
Trwające tłumaczenie można anulować; anulowane lub nieudane tłumaczenie nie
zmienia zawartości.

**Stany.** Gdy ustawienie jest wyłączone, przycisku nie ma. Gdy jest włączone,
ale bez użytecznych poświadczeń albo przy wyłączonym module **Poświadczenia**,
przycisk jest nieaktywny i pokazuje powód. Treść większa niż limit jest
odrzucana, zanim cokolwiek zostanie wysłane.

**Audyt.** Każde żądanie, które wysłało tekst do dostawcy — zakończone, częściowo
zakończone lub nieudane — zostawia jeden wpis audytu
`cms.page_builder.translate` z redaktorem, treścią (typ i id), językami,
dostawcą i modelem, liczbą tekstów i znaków, obowiązującym limitem, zakresem i
wynikiem. Sam tekst nigdy nie jest zapisywany.

## Zakres: kanał sprzedaży i język

Każda strona, blok, szablon i hook jest przypisany do jednego lub kilku kanałów sprzedaży (relacja
wiele-do-wielu z powielonym `code`/`slug` w wierszu łączącym, aby baza danych pilnowała unikalności w
obrębie kanału). Ten sam `slug` może istnieć w dwóch kanałach — to niezależne wiersze. Języki są
zapisane jako tablica JSONB w każdej encji; odczyt w storefroncie stosuje standardową regułę
wartości zastępczej platformy (żądany język → język domyślny kanału → 404).

`ScopePicker` w panelu ogranicza listę języków dla kanału do zbioru języków skonfigurowanych w tym
kanale; zapis strony, której `languages` zawiera kod nieobsługiwany przez żaden z przypisanych
kanałów, zwraca `400 CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE`.

## Hooki tworzone przy instalacji

Przy starcie idempotentny mechanizm uzgadniania tworzy 23 podstawowe kody hooków z
`is_system=true`. Obejmują standardowe miejsca wstawiania treści w storefroncie:

```
header.top
homepage.top, homepage.bottom
footer.before, footer.top, footer.bottom, footer.after, footer.copyright
category.top, category.bottom
product.top, product.bottom, product.buttons.after
search.top, search.bottom
page.top, page.bottom
cms.page.top, cms.page.bottom
login.top, login.bottom
register.top, register.bottom
```

Każdy komponent serwerowy `<Hook code="…" />` pobiera `/api/v1/cms/hooks/by-code` z wyznaczonym
kanałem i językiem i wyświetla każdy aktywny przypięty blok w kolejności `position`. Brak przypięć
albo nieudane pobranie nic nie wyświetla — hooki nie mogą zepsuć wyświetlania strony.

## API HTTP

### Panel administracyjny (`/api/v1/admin/cms`)

| Metoda  | Ścieżka                                                | Przeznaczenie                                         |
| ------- | --------------------------------------------------- | ----------------------------------------------- |
| GET     | `/pages`                                            | Stronicowana lista stron z filtrami.               |
| POST    | `/pages`                                            | Utworzenie strony (zawsze zaczyna jako `draft`). |
| GET     | `/pages/:id`                                        | Szczegóły z pełną treścią i wersją.  |
| PATCH   | `/pages/:id`                                        | Edycja metadanych, w tym `parentPageId`, `parentPathInUrl`, `breadcrumbsVisible`, `breadcrumbsScheme`, `breadcrumbsOverlay`, `shareImageAssetId` i `translations` (nazwa, slug i opis w każdym języku, zastępowane w całości); uwzględnia `If-Match` przez `version`. Rodzic tworzący cykl albo zbyt głęboki daje `422 CMS_PAGE_PARENT_CYCLE`; adres, który ma już inna strona, daje `409 CMS_SLUG_CONFLICT`. |
| PUT     | `/pages/:id/content/:language`                      | Zapis drzewa Page Buildera dla danego języka. Powtórzona albo zastrzeżona kotwica daje `422 CMS_DUPLICATE_ANCHOR` / `CMS_RESERVED_ANCHOR`. |
| POST    | `/pages/:id/{publish,archive,unarchive}`            | Przejścia w cyklu życia.                          |
| DELETE  | `/pages/:id`                                        | Trwałe usunięcie (przypisania do kanałów są usuwane kaskadowo).        |
| Analogicznie    | `/blocks/*`                                         | Ta sama postać; `code` unikalny w obrębie kanału; ochrona odwołań przy usuwaniu. |
| Analogicznie    | `/templates/*`                                      | Ta sama postać, bez flagi `active`.             |
| GET     | `/hooks`, `/hooks/:id`                              | Lista i szczegóły z liczbą przypiętych bloków.        |
| POST    | `/hooks`                                            | Utworzenie hooka przez administratora (niesystemowego).            |
| PATCH   | `/hooks/:id`                                        | Edycja nazwy, aktywności i zakresu; `code` nie można zmienić.|
| DELETE  | `/hooks/:id`                                        | Odrzucane z 409, gdy `is_system=true`.              |
| GET / POST / PATCH / DELETE | `/hooks/:id/attachments[/:blockId]` | Przypinanie, zmiana kolejności i odpinanie bloków w hooku.     |
| GET     | `/page-builder/config?salesChannelId=`              | Połączony opis Page Buildera (tylko metadane) z `brandTokens`: obowiązującym zestawem marki wskazanego kanału albo zestawem globalnym. |
| GET     | `/brand-tokens?salesChannelId=`                     | Zestaw globalny, nadpisanie wskazanego kanału, zestaw obowiązujący i jego ostrzeżenia o kontraście. `cms.read`. Zob. [Marka](./brand.md). |
| PUT     | `/brand-tokens`                                     | Zapis zestawu globalnego albo nadpisania jednego kanału (`tokens: null` je resetuje). `cms.brand`. |
| GET     | `/page-builder/translation`                         | Stan tłumaczenia: `ready` (dostawca, model), `disabled`, `not_configured` albo `unavailable`, oraz limit rozmiaru. `cms.translate`. |
| POST    | `/page-builder/translate`                           | Tłumaczy zawartość (opcjonalnie jeden komponent albo zaznaczony tekst) na język; nic nie jest zapisywane. `cms.translate`. |

### Storefront (`/api/v1/cms`)

| Metoda | Ścieżka                              | Zwraca                                                        |
| ------ | --------------------------------- | -------------------------------------------------------------- |
| GET    | `/pages/by-slug?slug=…&language=…`| Stronę z `embeds.blocks`, `embeds.templates` i plikami. `slug` przyjmuje całą ścieżkę publiczną strony w dowolnym z jej języków; własny slug zagnieżdżonej strony też działa. |
| GET    | `/blocks/by-code?code=…&language=…`| Blok (jeden, z filtrowaniem według kanału, tylko aktywny).|
| GET    | `/hooks/by-code?code=…&language=…`| Uporządkowaną listę aktywnych bloków dla wskazanego hooka.     |

Odczytana strona zawiera też `path` (swoją ścieżkę publiczną w kanale i
wyświetlanym języku), `url` (tę ścieżkę tak, jak linkuje ją storefront, pod
prefiksem języka), `alternates` (`{language, url}` dla każdego
języka, w którym jest wyświetlana), `name` w wyświetlanym języku,
`breadcrumbs` (`visible`, `scheme`, `overlay: true` tylko wtedy, gdy ścieżka
leży na pierwszej sekcji, i `trail` — listę przodków, każdy jako
`{name, slug, path}`, ze `slug` i `path` równymi null dla przodka
nieopublikowanego w kanale), `share.imageUrl` i `languages`.

Tokeny marki mają własny publiczny odczyt,
`GET /api/v1/storefront/cms/brand-tokens`: obowiązujący zestaw dla wyznaczonego
kanału, z `cache-control: public, max-age=60`.

Kanał jest wyznaczany najpierw z nagłówka `X-Sales-Channel`, a w jego braku jest to domyślny kanał
systemowy. Język — najpierw z `?language=`, potem z `Accept-Language`, a na końcu jest to język
domyślny skonfigurowany dla kanału.

## Odczyt w storefroncie i pamięć podręczna w Redis

Jedna usługa, `StorefrontResolver`, obsługuje wszystkie trzy odczyty dla storefrontu: jedno
zapytanie dla encji głównej, jedno zapytanie zbiorcze dla każdego typu osadzenia (`InsertBlock` /
`InsertTemplate`) na każdym poziomie zagnieżdżenia oraz jedno zbiorcze wywołanie
`assetsLibrary.resolveUrl` dla wszystkich osadzonych plików. Zagnieżdżenie jest ograniczone do 3
poziomów; cykle i głębsze grafy są zastępowane elementem `MissingComponentPlaceholder` widocznym w
panelu.

Wyniki są przechowywane w Redis z TTL 5 minut, w trzech rodzinach kluczy:

```
cms:v1:page:<slug>:<channel>:<language>
cms:v1:block:<code>:<channel>:<language>
cms:v1:hook:<code>:<channel>:<language>
```

Unieważnianie następuje przy każdym zapisie strony, bloku, szablonu lub hooka:

- Zapis strony → usuwa `cms:v1:page:<slug>:*` dla każdego sluga przypisanego do strony.
- Zapis bloku → usuwa klucze bloku oraz wszystkie klucze stron i hooków (nie śledzimy jeszcze,
  które strony i hooki osadzają który blok; w skali platformy usuwanie całości jest akceptowalne).
- Zapis szablonu → usuwa wszystkie klucze w przestrzeni CMS.
- Zapis hooka albo przypięcia → usuwa klucze hooka.

### Pamięć podręczna storefrontu

Storefront przechowuje drugą kopię każdego odczytu CMS w Data Cache Next.js przez 60 sekund,
oznaczoną tagami z `CMS_STOREFRONT_CACHE_TAGS` w `@endora-commerce/contracts`. Samo usunięcie
kluczy z Redis pozostawiłoby tę kopię, dlatego po zatwierdzeniu zapisu i usunięciu kluczy z Redis
moduł publikuje na EventBus zdarzenie `cms.content_changed.v1` i sam na nie odpowiada, wysyłając
odpowiednie tagi do `/api/revalidate` storefrontu:

| Zapis | Odświeżane tagi |
| --- | --- |
| Strona | `cms:page:<slug>` dla każdego sluga strony, `cms:page-index` |
| Blok | `cms:block:<code>`, `cms:page`, `cms:hook` |
| Szablon | `cms:page` |
| Hook albo przypięcie | `cms:hook:<code>` |
| Ustawienia marki | `cms:brand` — wysyłany od razu po zatwierdzeniu zapisu, nie przez zdarzenie |

Ręczne czyszczenie pamięci podręcznej na ekranie pamięci podręcznej modułu
Settings odświeża ten sam tag przez przestrzeń `cms-brand`.

Zapisana lub opublikowana strona jest więc widoczna przy następnym żądaniu: zapis wysyła zmianę
w zakresie EventBus i odpowiada dopiero wtedy, gdy storefront usunie tagi, więc nawet żądanie wysłane
w chwili zakończenia zapisu dostaje nową treść. Odświeżanie wymaga zmiennych `STOREFRONT_BASE_URL`
i `REVALIDATE_SECRET` po stronie backendu oraz **tego samego** sekretu po stronie storefrontu; bez
nich jest pomijane, a zabezpieczeniem pozostaje okno 60 sekund (pierwsze żądanie po upływie okna
dostaje wtedy jeszcze raz poprzednią wersję, a storefront pobiera nową w tle). Działa w trybie
best-effort: storefront niedostępny, nieodpowiadający w ciągu 3 sekund albo odrzucający wywołanie
jest odnotowywany w logu i nigdy nie powoduje błędu zapisu. Odrzucenie ze statusem 401 oznacza, że
sekrety po obu stronach się różnią.

Inny moduł, który przechowuje treść CMS wewnątrz własnej odpowiedzi, subskrybuje to samo zdarzenie
przez `ctx.subscribe`; robi tak `megamenu` dla bloków osadzanych w menu. Ładunek zdarzenia to
`CmsContentChange`: rodzaj (`page`, `block`, `template`, `hook`) oraz zmienione slugi lub kody.

Cel wydajnościowy: odczyt strony z 5 osadzonymi blokami i 3 osadzonymi szablonami trwa
&lt; 200 ms p95 bez pamięci podręcznej, a z nią &lt; 5 ms.

## Migracja z dawnego `cms_pages`

Wcześniej `cms_pages` zawierało `path`, `body` (HTML w poszczególnych językach) i wyliczenie
`status`. Migracja `20260505T130214_cms_init.ts` dodaje nowy zestaw kolumn (`slug`, `name`, `active`, `content`,
`languages`, `version`, `meta_*`) i idempotentnie uzupełnia każdy wiersz:

- `slug = path`
- `name = title['en-US']` (w miarę możliwości)
- `active = (status = 'published')`
- struktura `content` z `body`, w której HTML każdego języka trafia do pojedynczego węzła `Text` z
  `tiptapHtml`
- tablica `languages` = klucze niepustych treści w `body`
- przypisanie do domyślnego kanału sprzedaży platformy przez `cms_page_sales_channels`

Ponowne uruchomienie uzupełniania na częściowo zmigrowanych danych niczego nie zmienia. Dawne kolumny
`path`, `title` i `body` pozostają przez jedno wydanie jako kopie; wyszukiwanie odwołań do plików
obejmuje `body` ze względu na zgodność wsteczną.

## Rozszerzanie Page Buildera

Inne moduły deklarują bloki we własnym manifeście i dostarczają komponenty wyświetlające we własnym
pakiecie. Zob. przewodnik [Rozszerzanie Page Buildera](./extending-page-builder): deklaracja w
manifeście, trzy warstwy i arkusz stylów bloków.

## Kody błędów

`CMS_PAGE_NOT_FOUND`, `CMS_BLOCK_NOT_FOUND`, `CMS_TEMPLATE_NOT_FOUND`, `CMS_HOOK_NOT_FOUND`,
`CMS_SLUG_CONFLICT`, `CMS_CODE_CONFLICT`, `CMS_REFERENCED`, `CMS_HOOK_SYSTEM_PROTECTED`,
`CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE`, `CMS_SCHEMA_UPGRADE_FAILED`,
`CMS_DUPLICATE_ANCHOR` i `CMS_RESERVED_ANCHOR` (422, z `details.anchor`),
`CMS_PAGE_PARENT_CYCLE` (422), a dla
tłumaczenia `CMS_TRANSLATION_DISABLED`, `CMS_TRANSLATION_NOT_CONFIGURED`,
`CMS_TRANSLATION_UNAVAILABLE` (409), `CMS_TRANSLATION_TOO_LARGE` (413, z
ustawionym `limit`), `CMS_TRANSLATION_SELECTION_NOT_FOUND` (422) oraz
`CMS_TRANSLATION_PROVIDER_FAILED` (502, `details.code` jedno z
`credentials_rejected`, `rate_limited`, `unavailable`, `timeout`, `malformed`).

Wszystkie odpowiedzi z błędem mają strukturę zgodną z kontraktem błędów platformy w
`packages/contracts/src/errors.ts`.
