---
title: Obsługa w panelu administracyjnym
sidebar_position: 2
---

# Obsługa kanałów sprzedaży w panelu administracyjnym

Jak administrator platformy na co dzień obsługuje moduł kanałów sprzedaży w panelu
administracyjnym. Każda opisana tu czynność jest też dostępna przez administracyjne API HTTP modułu.

## Gdzie to znaleźć

Pasek boczny → **Operations → Sales channels**.

Lista pokazuje wszystkie kanały zarejestrowane w platformie. Domyślny kanał systemowy jest oznaczony
etykietą `System default` i zawsze istnieje (świeżo zainstalowana platforma przy pierwszym starcie
automatycznie dostaje kanał `default`).

## Tworzenie nowego kanału

1. Kliknij **+ New channel**.
2. Wypełnij pola:
   - **Code** — identyfikator techniczny małymi literami; po utworzeniu nie można go zmienić.
   - **Display name** — obecnie jeden tekst w `en-US`; obsługa wielu języków zostanie dodana
     później.
   - **Theme code** *(opcjonalne)* — identyfikator, na podstawie którego storefront wybiera motyw.
   - **Languages** — lista wielokrotnego wyboru z wyszukiwaniem, obejmująca aktywne wpisy
     Słownika języków. Wpisz fragment kodu (`pl-`) albo nazwy (`Polish`, `Polski`), aby zawęzić
     listę; pozycję dodasz klawiszem **Enter** albo kliknięciem, a usuniesz znakiem **×** na jej
     etykiecie albo klawiszem **Backspace** w pustym polu wyszukiwania. Wymagany jest co najmniej
     jeden język.
   - **Default language** — lista wyboru z wyszukiwaniem, w której są tylko języki wybrane powyżej.
     Usunięcie języka, który jest obecnie domyślny, czyści to pole: formularz o tym informuje i nie
     da się go zapisać, dopóki ponownie nie wskażesz języka domyślnego — nigdy nie wybiera go za
     Ciebie.
   - **Currencies** / **Default currency** — te same dwie kontrolki dla Słownika walut, z tą samą
     regułą dla wartości domyślnej.
   - **Active** *(domyślnie `true`)*.
   - **Open to anonymous visitors** *(domyślnie włączone)* — zob.
     [Otwieranie i zamykanie sklepu dla niezalogowanych odwiedzających](#anonymous-access).
3. Kliknij **Create channel**. System odrzuci operację, gdy kod jest już używany albo którykolwiek kod
   języka lub waluty jest nieznany.

## Edycja istniejącego kanału

1. Kliknij `code` kanału na liście.
2. Strona edycji wczytuje dane kanału. Wprowadź zmiany i kliknij **Zapisz**. Przycisk pokazuje, ile
   zmian czeka („Zapisz 2 zmiany”), i nic nie robi, gdy nie ma nic do zapisania.
3. Jeśli inny administrator zmienił ten sam kanał między wczytaniem strony a zapisem, zapis zwróci
   baner konfliktu 412 z bieżącą wersją. Odśwież stronę, aby pobrać aktualny stan, i ponownie
   wprowadź swoje zmiany.

Strona edycji ma **jeden przycisk Zapisz**. Zapisuje własne pola kanału, a gdy inny moduł doda do
strony edycji sekcję z własnymi zmianami — także je: najpierw kanał, potem każdą sekcję. Jeśli kanał
zostanie odrzucony, żadna sekcja nie jest zapisywana; jeśli kanał zostanie zapisany, a sekcja nie,
podsumowanie u góry formularza mówi, co zapisano, a czego nie, a kolejne Zapisz zapisuje tylko to, co
zostało. **Anuluj** odrzuca niezapisane zmiany i bez pytania wraca do listy. Przejście linkiem w inne
miejsce panelu albo zamknięcie lub odświeżenie karty przeglądarki z niezapisanymi zmianami wymaga
potwierdzenia.

**Deactivate** i **Re-activate** działają od razu i zachowują niezapisane zmiany: pole, które
zmieniono, zachowuje Twoją wartość, każde inne pole (łącznie ze statusem) pokazuje kanał w obecnym
stanie, a kolejne Zapisz wysyła Twoje zmiany, nie cofając zmiany statusu.

**Magazyny dla tego kanału**, sekcja dodawana przez moduł Magazyn pod formularzem, nie jest częścią
zapisu: przypisanie lub usunięcie magazynu albo ustawienie go jako domyślnego działa w chwili
wykonania, a nagłówek sekcji ma etykietę **Działa od razu**.

## Otwieranie i zamykanie sklepu dla niezalogowanych odwiedzających {#anonymous-access}

Pole wyboru **Open to anonymous visitors** w formularzu kanału decyduje, kto może korzystać ze
storefrontu kanału:

- **Włączone** (domyślnie, i tak działał każdy kanał, zanim pojawiła się ta opcja) — każdy może
  przeglądać sklep; zalogowani klienci mogą z niego korzystać, gdy ich organizacja jest przypisana do
  kanału.
- **Wyłączone** — sklep obsługuje wyłącznie zalogowanych klientów. Niezalogowany odwiedzający z
  każdej strony sklepu trafia na stronę logowania z komunikatem, że sklep jest dostępny dla
  zalogowanych klientów biznesowych; nie dostaje niczego z katalogu, cen ani treści. Rejestracja
  firmy pozostaje dostępna ze strony logowania, a zarejestrowana tam organizacja otrzymuje ten kanał.
  Samodzielna rejestracja klienta indywidualnego (B2C) nie jest w zamkniętym sklepie oferowana.

Na liście kanałów zamknięty kanał ma etykietę **Sign-in required**.

To, czy niezalogowani odwiedzający widzą **ceny**, to osobne ustawienie i nie ma go w tym
formularzu: *tryb wyświetlania dla niezalogowanych* (`pricing.unauthenticated_display_mode`).
Podpowiedź pod polem wyboru prowadzi do *Ustawień cenowych*, gdzie ustawia się go dla wszystkich
kanałów; ekran *Ustawienia* ustawia go dla jednego kanału. Tryb *Żaden* ukrywa ceny do czasu
zalogowania. Nadpisanie trybu dla produktu lub kategorii ma przed nim pierwszeństwo, także dla
niezalogowanych odwiedzających. Zalogowani klienci widzą ceny zgodnie ze swoim trybem wyświetlania.
Kanały miały kiedyś własną flagę widoczności cen, która ukrywała ceny także przed zalogowanymi
klientami; została wycofana, a każdy kanał, który miał ją wyłączoną, dostał tryb *Żaden* dla
niezalogowanych, więc ci nadal nie widzą tam cen.

Zamykając sklep, pamiętaj o jednej sprawie:

- **O tym, kto wejdzie przez rejestrację, decyduje moderacja.** Organizacja zarejestrowana w
  zamkniętym sklepie otrzymuje jego kanał. Przy automatycznej moderacji jest od razu aktywna, więc
  dostęp dostaje każdy, kto zarejestruje tam firmę; przy moderacji ręcznej nikt nie wejdzie, dopóki
  operator nie zatwierdzi organizacji.

## Decydowanie, którzy klienci mogą korzystać ze sklepu

Zalogowany klient może korzystać ze sklepu tylko wtedy, gdy jego organizacja jest przypisana do
kanału sklepu. Przypisania ustawia się na stronie organizacji, w panelu **Kanały sprzedaży** (zob.
dokumentację modułu organizacji); organizacja musi zachować co najmniej jeden kanał. Klient, którego
organizacja nie jest przypisana, przy logowaniu dostaje odmowę *„To konto nie ma dostępu do tego
sklepu.”*, a jeśli przypisanie zostanie usunięte, gdy jest zalogowany, widzi ekran *Brak dostępu do
tego sklepu* z listą sklepów, z których może korzystać.

Na tej liście sklep jest linkiem, gdy ustawienie **Storefront URL** jego kanału jest wypełnione; w
przeciwnym razie widać tylko nazwę sklepu.

Przy wprowadzeniu tej reguły każda istniejąca organizacja otrzymała domyślny kanał systemowy oraz
każdy kanał, w którym miała już zamówienia, więc żaden dotychczasowy klient nie stracił dostępu do
sklepu, w którym kupował.

## Prefiks języka domyślnego w adresach URL {#prefix-default-language}

Na ekranie edycji kanału przełącznik **Prefiks języka domyślnego w adresach URL** decyduje,
czy język domyślny kanału ma prefiks w adresach sklepu (`/pl/p/wiertarka`), czy nie
(`/p/wiertarka`). Pozostałe języki kanału zawsze mają prefiks (`/en/p/drill`). Pod
przełącznikiem ekran pokazuje prefiks każdego języka kanału, przeliczany przy zmianie języków.

- Nowe kanały startują z przełącznikiem **włączonym**. Kanały istniejące przed aktualizacją,
  która wprowadziła przełącznik, startują z **wyłączonym**, więc ich adresy się nie zmieniły.
- **Włączenie** przenosi wszystkie adresy języka domyślnego pod jego prefiks. Stare adresy są
  przekierowywane (307) do języka wskazanego przez `?lang=`, ciasteczko `lang` lub języki
  przeglądarki odwiedzającego — nic zaindeksowanego ani zapisanego w zakładkach nie przestaje
  działać.
- **Wyłączenie** sprawia, że adres bez prefiksu znów oznacza język domyślny; adres z
  prefiksem odpowiada trwałym przekierowaniem na niego.
- **Zmiana języków kanału też zmienia adresy**: nowy język dostaje prefiks, a dodanie drugiego
  wariantu języka (`en-GB` obok `en-US`) przełącza oba na pełne prefiksy (`/en-us`, `/en-gb`),
  podczas gdy `/en` nadal przekierowuje.
- Przeglądarki mogą pamiętać zapisane trwałe przekierowanie do godziny po zmianie.
- Operatorzy z dostępem tylko do odczytu kanałów sprzedaży widzą przełącznik wyłączony.
- Strony CMS, której slug zaczyna się od prefiksu języka (na przykład `en`), nie można
  zapisać; istniejąca jest oznaczona na liście stron CMS jako zasłonięta prefiksem języka.

## Dezaktywacja kanału

Użyj przycisku **Deactivate** na stronie szczegółów kanału. Dezaktywacja jest idempotentna i
odwracalna:

- Kanał przestaje być akceptowany przy wyznaczaniu kanału żądania (żądania ze storefrontu lub POS
  wskazujące ten kanał są odrzucane z `INACTIVE_SALES_CHANNEL`).
- Kanał znika z listy „Add to channel” na każdej stronie edycji encji.
- Istniejące przypisania oraz historyczne zamówienia i oferty nadal się do niego odwołują.

Domyślnego kanału systemowego nie można dezaktywować.

## Trwałe usunięcie kanału

Przycisk **Delete** usuwa dane. Platforma odrzuca tę operację, gdy:

- kanał jest domyślnym kanałem systemowym;
- do kanału odwołuje się jakiekolwiek zamówienie lub oferta — tych przypisań nie można zmienić, więc
  jedynym sposobem na „uwolnienie” kanału jest pozostawienie go (właściwą odpowiedzią jest
  dezaktywacja);
- usunięcie kanału zostawiłoby jedną lub więcej encji (produktów, klientów…) przypisanych do **zera**
  kanałów — *chyba że* potwierdzisz przepisanie ich do kanału domyślnego; wtedy w tej samej
  transakcji, zanim wiersz kanału zostanie usunięty, encje są przypisywane do domyślnego kanału
  systemowego.

`ON DELETE CASCADE` tabel łączących usuwa wszystkie pozostałe wiersze przypisań.

## Zarządzanie przypisaniami ze strony encji

Każda strona edycji encji obsługująca przypisania do kanałów (na początek produkty; pozostałe 8 typów
to mechaniczna praca do wykonania później) ma na dole kartę **Sales channels**:

- Lista pokazuje kanały, do których encja jest obecnie przypisana, z etykietą `System default` tam,
  gdzie to potrzebne.
- Lista wyboru pokazuje kanały, do których encja **nie** jest jeszcze przypisana. Wybierz jeden i
  kliknij **Add**.
- **Remove** uruchamia regułę „co najmniej jeden kanał” — gdy encja ma tylko jeden kanał, a ty
  potwierdzisz przepisanie do kanału domyślnego, system przypisze ją do domyślnego kanału
  systemowego, zanim zakończy usuwanie.

## Kilka storefrontów

Aby uruchomić dwa storefronty na tym samym backendzie (np. `serwisA.com` i `serwisB.com`), ustaw w
backendzie zmienną środowiskową `SALES_CHANNEL_HOST_MAP`:

```env
SALES_CHANNEL_HOST_MAP=serwisA.com=channel-a,serwisB.com=channel-b
```

Host w tej mapie to host, pod którym wywoływany jest **backend**, więc nadaj każdemu storefrontowi
własny adres backendu (jego `BACKEND_BASE_URL` i `NEXT_PUBLIC_API_BASE_URL`) i przypisz w mapie ten
adres; wywołania każdego storefrontu trafiają wtedy do jego kanału i nagłówek nie jest potrzebny.
Można też przed każdym storefrontem postawić serwer pośredniczący (reverse proxy), który ustawia
nagłówek `X-Sales-Channel`. Niezależnie od sposobu wyznaczenia kanału storefront podaje go potem w
każdym wywołaniu backendu, także w wywołaniach, które jego strony wykonują z przeglądarki.

W każdym storefroncie:

- **produkty, kategorie, ceny i promocje** to te przypisane do jego kanału;
- **niezalogowani odwiedzający** są obsługiwani tylko wtedy, gdy kanał jest dla nich otwarty;
- **zalogowani klienci** są obsługiwani tylko wtedy, gdy ich organizacja jest przypisana do kanału;
- **koszyki** należą do sklepu, w którym je napełniono: klient kupujący w dwóch sklepach ma koszyk w
  każdym z nich, wyceniony według cen danego sklepu.

## Czego administrator nie może zrobić

- Przypisać zamówienia ani zapytania ofertowego do innego kanału po utworzeniu. Tego przypisania nie
  można zmienić; to świadoma gwarancja na potrzeby audytu, a nie przeoczenie.
- Usunąć domyślnego kanału systemowego. Mechanizm uzgadniania przy starcie odtworzy go przy
  następnym uruchomieniu platformy.
- Ustawić dwóch kanałów jednocześnie jako domyślnych. Blokuje to częściowy indeks unikalny w bazie
  danych.
