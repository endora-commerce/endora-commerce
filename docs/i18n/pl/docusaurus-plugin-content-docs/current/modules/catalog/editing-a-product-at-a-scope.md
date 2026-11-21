---
title: Edycja produktu w zakresie
description: Jak używać przełącznika zakresu w edytorze produktu, aby ustawiać wartości w zakresie Global, kanału i kanału × języka, oraz co edytor podpowiada w trakcie.
---

# Edycja produktu w zakresie

Edytor produktu edytuje **jeden zakres naraz**. Przełącznik zakresu w nagłówku edytora wybiera, który, a każda karta
pokazuje i zapisuje wartości w tym zakresie. Co oznaczają trzy poziomy i jak wybiera się wartość, opisuje strona
[Zakresy produktu — globalny, kanał oraz kanał × język](./per-channel-per-language-overrides.md).

## Przełącznik zakresu

Przełącznik oferuje trzy poziomy, od najszerszego:

1. **Global** — wartość dla wszystkich kanałów sprzedaży i wszystkich języków;
2. **Kanał** — wybierz kanał sprzedaży (język zostaje „Wszystkie języki”), aby edytować wartość kanału;
3. **Kanał × język** — wybierz kanał sprzedaży, a potem jeden z jego języków.

Oferowane są tylko zakresy poprawne dla produktu: produkt musi być w kanale, a kanał musi oferować język. Produkt,
którego nie ma w żadnym kanale sprzedaży, można edytować tylko w zakresie Global. Jeśli otwarty adres wskazuje
kanał lub język, który nie jest już poprawny, edytor otwiera się w najbliższym poprawnym zakresie i podaje powód
(„Otwarto w zakresie …”). Poza zakresem Global widać baner „Zmiany dotyczą tylko zakresu: …”. Obok listy języków jest
link **Mapa zakresów**, który otwiera Mapę zakresów w panelu po prawej stronie.

Zapis dotyczy tylko bieżącego zakresu. Nigdy nie zmienia wartości w żadnym innym zakresie. Przycisk **Zapisz** jest
na pasku zakresu, obok zakresu, który zapisuje, i pokazuje, ile zmian czeka na zapis („Zapisz 2 zmiany”). Na szerokim
ekranie pasek zakresu zostaje u góry okna podczas przewijania, więc Zapisz jest zawsze pod ręką; na wąskim ekranie
Zapisz jest na pasku przypiętym do dołu ekranu.

## Co obejmuje Zapisz

Zapisz zapisuje wszystko, co zmieniono w produkcie, niezależnie od tego, w którym miejscu strony:

- pola produktu na każdej zakładce, w bieżącym zakresie, łącznie z polami SEO;
- ustawienia magazynowe produktu na zakładce **Magazyn** — **Śledź stan magazynowy**, zamówienia przy braku
  stanu, próg niskiego stanu i jego tryb oraz strategię realizacji z kolejnością magazynów. Istnieją tylko w zakresie
  Global. Zakładka nie ma własnego przycisku zapisu, a zmiana trybu progu nie zapisuje się już sama; przywrócenie
  zapisanej wartości usuwa zmianę z licznika;
- **Ceny bazowe** na zakładce **Ceny**, gdy moduł Cenniki jest włączony. Nie ma przycisku *Zapisz ceny*.

Licznik na przycisku Zapisz sumuje je wszystkie („Zapisz 3 zmiany”). Zmiany na zakładce, którą opuszczono, zostają
i są liczone, a przełączenie zakładki o nic nie pyta. Zapisz widzi każdy, kto może zmienić produkt albo którąkolwiek z
tych części, i zapisuje tylko to, co wolno mu zmienić.

**Najpierw wszystko jest sprawdzane.** Pola produktu są sprawdzane jak dotąd, a ceny bazowe sprawdza serwer, nie
zapisując ich. Jeśli cokolwiek zostanie odrzucone, nic nie jest zapisywane, a wszystkie zmiany zostają. Odrzucone pole
produktu pokazuje powód przy polu, jak dotąd. Gdy ceny bazowe mają problemy, podsumowanie pod paskiem zakresu wymienia
każdą część z jej problemami („Ceny bazowe — 1 problem”); **Pokaż** otwiera zakładkę tej części i przechodzi do
pierwszego pola z błędem.

**Potem części są zapisywane jedna po drugiej**: najpierw pola produktu, potem ceny bazowe. Każda część trafia do
dziennika audytu tak, jak zapisuje ją jej moduł — zapis produktu jako jeden wpis, ceny bazowe jako osobny.

- Jeśli pola produktu zostaną odrzucone — ktoś inny zapisał produkt w międzyczasie, kontrola kompletności odrzuca
  zmianę statusu, klucz URL jest zajęty, wartość jest niepoprawna — ceny bazowe też nie są zapisywane. Edytor podaje
  powód, jak dotąd.
- Jeśli pola produktu zostaną zapisane, a ceny bazowe nie, podsumowanie mówi o obu („Zapisano: Pola produktu. Nie
  zapisano: Ceny bazowe — *powód*”). Pola produktu nie czekają już na zapis; ceny bazowe nadal czekają, Zapisz liczy
  tylko je, a ponowne naciśnięcie zapisuje tylko ceny bazowe.
- Jeśli moduł Cenniki zostanie wyłączony, gdy ceny bazowe mają niezapisane zmiany, te zmiany są odrzucane, a edytor o
  tym informuje. Zapis odrzucony przez serwer, bo moduł został wyłączony, jest pokazywany jako niezapisana część.

## Co działa od razu

Niektóre działania na produkcie nie czekają na Zapisz. Są zapisywane w chwili użycia, każde osobno, i ani nie
dodają się do niezapisanych zmian, ani ich nie czyszczą. Każda sekcja z takim działaniem ma w nagłówku etykietę
**Działa od razu**, widoczną tylko tam, gdzie możesz z niego skorzystać:

- dodawanie, usuwanie, zmiana kolejności lub zastępowanie wariantów, pozycji zestawu, pozycji grupy, powiązań, zdjęć,
  załączników i jednostek opakowania;
- usuwanie przekierowania URL;
- kanały sprzedaży produktu na zakładce **Kanały**;
- **Stan po magazynach** na zakładce **Magazyn** — stan i próg niskiego stanu w każdym magazynie, każdy zapisywany
  własnym przyciskiem **Zastosuj** w wierszu. **Zastosuj** jest dostępny, gdy wartość różni się od zapisanej.

Ceny w pozostałych cennikach edytuje się w siatce cen cennika, nie tutaj. Zakładka **Ceny** nie ma etykiety: jej
ceny bazowe zapisuje Zapisz.

## Zmiana zakresu z niezapisanymi zmianami

Zmiany zapisuje się osobno dla każdego zakresu, więc zmiana zakresu (albo opuszczenie produktu linkiem powrotu lub
dowolnym innym linkiem w panelu, albo przycisk „Wstecz” przeglądarki między zakresami) z niezapisanymi zmianami — także
w cenach bazowych — otwiera okno z trzema wyborami:

- **Zapisz i kontynuuj** — zapisuje zmiany w zakresie, który opuszczasz, a potem przełącza zakres; jeśli którakolwiek
  część nie zostanie zapisana, zostajesz na miejscu;
- **Odrzuć zmiany** — porzuca wszystkie niezapisane zmiany na stronie i przełącza zakres;
- **Zostań tutaj** — zamyka okno i pozwala edytować dalej; po przycisku „Wstecz” przeglądarki adres wraca do zakresu,
  w którym zostajesz.

Jeśli zapis zostanie odrzucony, zostajesz na miejscu, a powód widać przy polu. Jeśli ktoś inny zapisał produkt w
międzyczasie, edytor zgłasza konflikt wersji; **Wczytaj ponownie** porzuca Twoje niezapisane zmiany i czyta produkt
od nowa, a przycisk mówi o tym wprost.

Takie pytanie jest jedno dla całej strony: żadna zakładka ani panel nie zadaje własnego. Zamknięcie lub odświeżenie
karty przeglądarki z niezapisanymi zmianami sprawia, że przeglądarka pyta przed opuszczeniem strony.

## Dziedziczenie albo wartość w tym zakresie

W zakresach Kanał i Kanał × język każde pole, które można w nim ustawić, pokazuje, skąd pochodzi jego wartość:

- **Dziedziczone** — pole ma zaznaczone „Użyj wartości z zakresu: *zakres nadrzędny*” i pokazuje wartość zakresu
  nadrzędnego tylko do odczytu, w polu z przerywaną ramką. Wiersz pod polem dodaje tylko to, czego nie mówi pole
  wyboru: „Brak wartości w żadnym wyższym zakresie”, gdy nic w łańcuchu jej nie ma, oraz „Dziedziczone z zakresu:
  Global” w zakresie Kanał × język, gdy kanał też nie ma własnej wartości;
- **Nadpisane** — pole ma własną wartość w tym zakresie;
- **Puste w tym zakresie** — pole ma celowo pustą wartość, która zatrzymuje łańcuch: wartość zakresu nadrzędnego nie jest
  używana.

Bez uprawnienia do zmiany produktu pola wyboru nie ma, więc każde pole mówi to słowami: etykieta **Dziedziczone**
(albo, dla pola tekstowego w zakresie Kanał × język, **Nieprzetłumaczone**) z „Dziedziczone z zakresu: *zakres*” albo
„Ustawione w tym zakresie”.

Aby ustawić wartość w tym zakresie, odznacz „Użyj wartości z zakresu: *zakres nadrzędny*” i wpisz ją. Aby wrócić do
wartości zakresu nadrzędnego, zaznacz pole ponownie; własna wartość zostaje usunięta przy zapisie. Pola wymaganego
(nazwy, wymaganego atrybutu) nie można zostawić pustego w zakresie: wpisz wartość albo zaznacz „Użyj wartości z
zakresu: *zakres*”.

Ta sama czynność jest dostępna na Mapie zakresów jako **Użyj wartości z zakresu: *zakres***, po potwierdzeniu.

## Czego brakuje w tym zakresie

Pod przełącznikiem zakresu edytor wymienia wymagane wartości, które zablokowałyby publikację w edytowanym zakresie:
„Brakuje w tym zakresie” oraz, w kanale, „Brakuje w tym kanale” wraz z językami, których dotyczy. Wartość liczy się
jako obecna, gdy istnieje w zakresie, w kanale albo w zakresie Global — w tej kolejności. W zakresie Global lista
zmienia się w „*N* niekompletnych zakresów” z linkiem do Mapy zakresów. Lista opiera się na **zapisanych**
wartościach; kontrola przy zapisie liczy razem wartości zapisane i niezapisane.

## Mapa zakresów

**Mapa zakresów** to przegląd wszystkich zakresów produktu: jedna komórka to jeden kanał sprzedaży w jednym
języku, kolumna „Cały kanał” zawiera wartości ustawione dla samego kanału, a w każdej komórce widać status (ustawiony
tutaj, z kanału albo z zakresu Global, oraz czy produkt jest tam teraz widoczny) i braki. **Edytuj w zakresie …**
otwiera edytor w tym zakresie, a link przy polu ustawia na nim fokus. Wartości zachowane dla kanału lub języka, które
produkt opuścił, są wymienione w sekcji „Nie obowiązuje już” i można je tam usunąć.

Mapa zakresów otwiera się w panelu po prawej stronie, nad kartą, na której jesteś — z linku obok listy języków oraz
z wiersza „*N* niekompletnych zakresów”. **Zamknij** albo Escape wraca do tej karty; link **Edytuj w zakresie …**
zamyka panel i otwiera edytor w tym zakresie. Adres panelu to adres produktu z `?scopeMap=1`; starszy link do
dawnej karty Mapa zakresów (`?tab=scopes`) również go otwiera.

## Tryb tylko do odczytu

Bez uprawnienia `catalog:write` edytor jest tylko do odczytu: „Tylko do odczytu — możesz oglądać wartości w każdym
zakresie”. Możesz przełączać zakres i czytać wartości, ich źródła oraz Mapę zakresów, ale żadnego pola nie można
zmienić.

## Pola dostępne tylko w zakresie Global albo tylko w kanale

- **Tylko Global** — SKU, typ, zestaw atrybutów, kategorie, ustawienia magazynowe, plik do pobrania, zestaw zdjęć w
  galerii, pliki i kolejność załączników, jednostki i ilości opakowań oraz każdy atrybut nieoznaczony jako zakresowy.
  W innym zakresie te karty pokazują wartość tylko do odczytu z komunikatem „Jest taka sama w każdym zakresie” i
  linkiem **Edytuj w zakresie Global**.
- **Global i Kanał, bez Kanał × język** — okres publikacji, odbiorcy, minimalna ilość zamówienia, możliwość zwrotu
  oraz atrybuty zakresowe, które nie są tekstowe (liczby, listy wyboru, wartości logiczne). W zakresie Kanał × język
  te pola nie są oferowane.

## Wymagane atrybuty a zapis w zakresie Global

Kontrola kompletności patrzy osobno na każdy kanał i język, więc wymagany atrybut może nie mieć wartości w zakresie
Global. Jest jeden wyjątek, zachowany celowo: **zapis w zakresie Global, który zawiera komórkę atrybutu albo zmianę
zestawu atrybutów, jest odrzucany (`required_empty`) dla każdego pustego wymaganego atrybutu — niezależnie od tego,
czy go zmieniłeś.** Uzupełnij wskazane atrybuty albo zapisz bez ruszania sekcji atrybutów. Zapis w zakresie Global
bez komórki atrybutu oraz zapisy w zakresie Kanał lub Kanał × język nie są z tego powodu odrzucane. Nazwy i klucza
URL nie można nigdy wyczyścić w zakresie Global.
