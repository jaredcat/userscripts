import type { MonkeyUserScript } from 'vite-plugin-monkey';

const metadata: MonkeyUserScript = {
  name: 'Kingshot Troop Formation %',
  namespace: 'https://github.com/jaredcat/userscripts',
  version: '1.0.4',
  description:
    'Injects per-squad in-game formation preset percentages into the Bear and Vikings Split tables. Warns when any troop type falls below its preset target. Persists inputs to localStorage across sessions. Sanitizes pasted numbers (commas, spaces) in calculator inputs.',
  match: ['https://www.kingshotguide.org/calculator/troops-calculator*'],
  grant: ['unsafeWindow'],
};

export default metadata;
