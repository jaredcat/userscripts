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

function fillEpisodeData(episodes: Episode[]): void {
  // Get all episode rows
  const rows = document.querySelectorAll<HTMLElement>('.multirow-item');

  episodes.forEach((episode, index) => {
    if (index >= rows.length - 1) {
      // Click "Add Another" button if we need more rows
      const addButton = document.querySelector<HTMLElement>('.multirow-add');
      addButton?.click();
    }

    const row = document.querySelectorAll<HTMLElement>('.multirow-item')[index];
    if (!row) return;

    // Fill episode number
    const numberInput = row.querySelector<HTMLInputElement>(
      'input[name="number[]"]',
    );
    if (numberInput) numberInput.value = episode.number;

    // Fill episode name
    const nameInput = row.querySelector<HTMLInputElement>(
      'input[name="name[]"]',
    );
    if (nameInput) nameInput.value = episode.name;

    // Fill overview
    const overviewInput = row.querySelector<HTMLTextAreaElement>(
      'textarea[name="overview[]"]',
    );
    if (overviewInput) overviewInput.value = episode.overview;

    // Fill date
    if (episode.date) {
      const dateInput = row.querySelector<HTMLInputElement>(
        'input[name="date[]"]',
      );
      if (dateInput) dateInput.value = episode.date;
    }

    // Fill runtime
    if (episode.runtime) {
      const runtimeInput = row.querySelector<HTMLInputElement>(
        'input[name="runtime[]"]',
      );
      if (runtimeInput) runtimeInput.value = episode.runtime.toString();
    }
  });
}

// Add button to trigger the fill
const btn = document.createElement('button');
btn.innerText = 'Auto-fill Episodes';
btn.style.position = 'fixed';
btn.style.top = '10px';
btn.style.right = '10px';
btn.style.zIndex = '9999';
btn.onclick = () => fillEpisodeData(episodeData);
document.body.appendChild(btn);
