const copy: Record<string, readonly [string, string, string, string]> = {
  tagline: [
    'An image editor for React that runs in the browser.',
    'Editor obrázků pro React, který běží v prohlížeči.',
    'Editor obrázkov pre React, ktorý beží v prehliadači.',
    'Edytor obrazów dla Reacta, który działa w przeglądarce.',
  ],
  copy: ['Copy', 'Kopírovat', 'Kopírovať', 'Kopiuj'],
  copied: ['Copied', 'Zkopírováno', 'Skopírované', 'Skopiowano'],
  examples: ['Examples', 'Ukázky', 'Ukážky', 'Przykłady'],
  fjord: ['Fjord', 'Fjord', 'Fjord', 'Fiord'],
  aurora: ['Aurora', 'Polární záře', 'Polárna žiara', 'Zorza'],
  cabin: ['Cabin', 'Chata', 'Chata', 'Chata'],
  lighthouse: ['Lighthouse', 'Maják', 'Maják', 'Latarnia'],
  'still-life': ['Still life', 'Zátiší', 'Zátišie', 'Martwa natura'],
  own_image: [
    'Your image',
    'Vlastní obrázek',
    'Vlastný obrázok',
    'Własny obraz',
  ],
  drop_hint: [
    'Drop, paste or browse',
    'Přetáhněte, vložte nebo vyberte',
    'Pretiahnite, vložte alebo vyberte',
    'Przeciągnij, wklej lub wybierz',
  ],
  drop_now: [
    'Drop to open',
    'Pusťte a otevře se',
    'Pustite a otvorí sa',
    'Upuść, aby otworzyć',
  ],
  language: ['Language', 'Jazyk', 'Jazyk', 'Język'],
  position: [
    'Tools position',
    'Poloha nástrojů',
    'Poloha nástrojov',
    'Położenie narzędzi',
  ],
  left: [
    'Tools on the left',
    'Nástroje vlevo',
    'Nástroje vľavo',
    'Narzędzia po lewej',
  ],
  right: [
    'Tools on the right',
    'Nástroje vpravo',
    'Nástroje vpravo',
    'Narzędzia po prawej',
  ],
  to_light: ['Light theme', 'Světlý motiv', 'Svetlý motív', 'Jasny motyw'],
  to_dark: ['Dark theme', 'Tmavý motiv', 'Tmavý motív', 'Ciemny motyw'],
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
