const copy: Record<string, readonly [string, string, string, string]> = {
  controls: ['Customize', 'Nastavení', 'Nastavenia', 'Ustawienia'],
  close_controls: [
    'Close settings',
    'Zavřít nastavení',
    'Zavrieť nastavenia',
    'Zamknij ustawienia',
  ],
  actions: ['Image', 'Obrázek', 'Obrázok', 'Obraz'],
  change_image: [
    'Try another image',
    'Zkusit jiný obrázek',
    'Skúsiť iný obrázok',
    'Wypróbuj inny obraz',
  ],
  upload: ['Open image', 'Otevřít obrázek', 'Otvoriť obrázok', 'Otwórz obraz'],
  check_changes: [
    'Check edits',
    'Zkontrolovat změny',
    'Skontrolovať zmeny',
    'Sprawdź zmiany',
  ],
  preview: [
    'Preview result',
    'Náhled výsledku',
    'Náhľad výsledku',
    'Podgląd wyniku',
  ],
  appearance: ['Appearance', 'Vzhled', 'Vzhľad', 'Wygląd'],
  theme: ['Theme', 'Motiv', 'Motív', 'Motyw'],
  light: ['Light', 'Světlý', 'Svetlý', 'Jasny'],
  dark: ['Dark', 'Tmavý', 'Tmavý', 'Ciemny'],
  language: ['Language', 'Jazyk', 'Jazyk', 'Język'],
  layout: ['Layout', 'Rozložení', 'Rozloženie', 'Układ'],
  position: [
    'Tools position',
    'Poloha nástrojů',
    'Poloha nástrojov',
    'Położenie narzędzi',
  ],
  left: ['Left', 'Vlevo', 'Vľavo', 'Po lewej'],
  right: ['Right', 'Vpravo', 'Vpravo', 'Po prawej'],
  tools: ['Tools', 'Nástroje', 'Nástroje', 'Narzędzia'],
  loading: [
    'Loading image…',
    'Načítám obrázek…',
    'Načítavam obrázok…',
    'Wczytuję obraz…',
  ],
  ready: [
    'Ready to edit',
    'Můžete upravovat',
    'Môžete upravovať',
    'Możesz edytować',
  ],
  changed: [
    'Image changed',
    'Obrázek změněn',
    'Obrázok zmenený',
    'Obraz zmieniony',
  ],
  not_image: [
    'Choose an image file.',
    'Vyberte soubor s obrázkem.',
    'Vyberte súbor s obrázkom.',
    'Wybierz plik obrazu.',
  ],
  too_large: [
    'Choose an image smaller than 20 MB.',
    'Vyberte obrázek menší než 20 MB.',
    'Vyberte obrázok menší ako 20 MB.',
    'Wybierz obraz mniejszy niż 20 MB.',
  ],
  read_failed: [
    'The image could not be read. Try another file.',
    'Obrázek se nepodařilo přečíst. Zkuste jiný soubor.',
    'Obrázok sa nepodarilo prečítať. Skúste iný súbor.',
    'Nie udało się odczytać obrazu. Wybierz inny plik.',
  ],
  unsaved: [
    'Unsaved changes',
    'Neuložené změny',
    'Neuložené zmeny',
    'Niezapisane zmiany',
  ],
  no_changes: [
    'No unsaved changes',
    'Žádné neuložené změny',
    'Žiadne neuložené zmeny',
    'Brak niezapisanych zmian',
  ],
  preview_ready: [
    'Preview ready',
    'Náhled je připraven',
    'Náhľad je pripravený',
    'Podgląd jest gotowy',
  ],
  settings_changed: [
    'Settings updated',
    'Nastavení změněno',
    'Nastavenia zmenené',
    'Ustawienia zmienione',
  ],
  saved: ['Image saved', 'Obrázek uložen', 'Obrázok uložený', 'Obraz zapisany'],
  cancelled: [
    'Editing cancelled',
    'Úpravy zrušeny',
    'Úpravy zrušené',
    'Edycja anulowana',
  ],
  load_failed: [
    'The image could not be loaded. Try another file.',
    'Obrázek se nepodařilo načíst. Zkuste jiný soubor.',
    'Obrázok sa nepodarilo načítať. Skúste iný súbor.',
    'Nie udało się wczytać obrazu. Wybierz inny plik.',
  ],
  result: [
    'Edited image',
    'Upravený obrázek',
    'Upravený obrázok',
    'Edytowany obraz',
  ],
  download: ['Download', 'Stáhnout', 'Stiahnuť', 'Pobierz'],
  close: ['Close', 'Zavřít', 'Zavrieť', 'Zamknij'],
};
export function demoCopy(locale: string) {
  const index = Math.max(
    0,
    ['en', 'cs', 'sk', 'pl'].indexOf(locale.split('-')[0])
  );
  return (key: string) => copy[key]?.[index] ?? key;
}
