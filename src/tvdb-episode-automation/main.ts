interface Episode {
  number: string;
  name: string;
  overview: string;
  date?: string;
  runtime?: number;
}

const episodeData: Episode[] = [
  {
    number: '4',
    name: 'American Stepdad',
    overview:
      'When Stan invites his recently widowed mother to move in, she and Roger fall in love and wed; Steve and his friends find a lost movie script.',
    date: '2012-11-18',
    runtime: 25,
  },
  {
    number: '5',
    name: "Why Can't We Be Friends?",
    overview:
      "When Stan decides that Snot isn't cool enough to be Steve's best friend, he tries to separate them by staging a shooting at an ice cream parlor.",
    date: '2012-12-5',
    runtime: 25,
  },
];

function fillRowField(
  row: HTMLElement,
  selector: string,
  value: string | undefined,
): void {
  if (value === undefined) return;
  const input = row.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    selector,
  );
  if (input) input.value = value;
}

function ensureRowExists(index: number): HTMLElement | undefined {
  let rows = document.querySelectorAll<HTMLElement>('.multirow-item');
  if (index >= rows.length - 1) {
    const multirowAddControl =
      document.querySelector<HTMLElement>('.multirow-add');
    multirowAddControl?.click();
    rows = document.querySelectorAll<HTMLElement>('.multirow-item');
  }
  return rows[index];
}

function fillEpisodeRow(row: HTMLElement, episode: Episode): void {
  fillRowField(row, 'input[name="number[]"]', episode.number);
  fillRowField(row, 'input[name="name[]"]', episode.name);
  fillRowField(row, 'textarea[name="overview[]"]', episode.overview);
  fillRowField(row, 'input[name="date[]"]', episode.date);
  fillRowField(row, 'input[name="runtime[]"]', episode.runtime?.toString());
}

function fillEpisodeData(episodes: Episode[]): void {
  for (const [index, episode] of episodes.entries()) {
    const row = ensureRowExists(index);
    if (!row) continue;
    fillEpisodeRow(row, episode);
  }
}

// Add button to trigger the fill
const button = document.createElement('button');
button.textContent = 'Auto-fill Episodes';
button.style.position = 'fixed';
button.style.top = '10px';
button.style.right = '10px';
button.style.zIndex = '9999';
button.addEventListener('click', () => fillEpisodeData(episodeData));
document.body.append(button);
