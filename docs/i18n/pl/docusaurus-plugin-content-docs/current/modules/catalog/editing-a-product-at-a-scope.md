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
(„Otwarto w zakresie …”). Poza zakresem Global widać baner „Zmiany dotyczą tylko zakresu: …”, a edytor mówi słowami,
gdzie jesteś („Edytujesz”). Obok jest link do karty **Mapa zakresów**.

Zapis dotyczy tylko bieżącego zakresu. Nigdy nie zmienia wartości w żadnym innym zakresie.

## Zmiana zakresu z niezapisanymi zmianami

Zmiany zapisuje się osobno dla każdego zakresu, więc zmiana zakresu (albo opuszczenie produktu, albo przycisk
„Wstecz” przeglądarki) z niezapisanymi zmianami otwiera okno z trzema wyborami:

- **Zapisz i kontynuuj** — zapisuje zmiany w zakresie, który opuszczasz, a potem przełącza zakres;
- **Odrzuć zmiany** — porzuca je i przełącza zakres;
- **Zostań tutaj** — zamyka okno i pozwala edytować dalej.

Jeśli zapis zostanie odrzucony, zostajesz na miejscu, a powód widać przy polu. Jeśli ktoś inny zapisał produkt w
międzyczasie, edytor zgłasza konflikt wersji; **Wczytaj ponownie** porzuca Twoje niezapisane zmiany i czyta produkt
od nowa, a przycisk mówi o tym wprost.

## Dziedziczenie albo wartość w tym zakresie

W zakresach Kanał i Kanał × język każde pole, które można w nim ustawić, pokazuje, skąd pochodzi jego wartość:

- **Dziedziczone** — pole ma zaznaczone „Użyj wartości z zakresu: *zakres nadrzędny*” i pokazuje wartość zakresu
  nadrzędnego wraz ze źródłem, tylko do odczytu. Pole tekstowe w zakresie Kanał × język pokazuje „Nieprzetłumaczone”;
  „Brak wartości” pojawia się, gdy nic w łańcuchu jej nie ma;
- **Nadpisane** — pole ma własną wartość w tym zakresie;
- **Puste w tym zakresie** — pole ma celowo pustą wartość, która zatrzymuje łańcuch: wartość zakresu nadrzędnego nie jest
  używana.

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

## Karta Mapa zakresów

Karta **Mapa zakresów** to przegląd wszystkich zakresów produktu: jedna komórka to jeden kanał sprzedaży w jednym
języku, kolumna „Cały kanał” zawiera wartości ustawione dla samego kanału, a w każdej komórce widać status (ustawiony
tutaj, z kanału albo z zakresu Global, oraz czy produkt jest tam teraz widoczny) i braki. **Edytuj w zakresie …**
otwiera edytor w tym zakresie, a link przy polu ustawia na nim fokus. Wartości zachowane dla kanału lub języka, które
produkt opuścił, są wymienione w sekcji „Nie obowiązuje już” i można je tam usunąć.

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
