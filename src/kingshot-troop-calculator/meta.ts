import type { MonkeyUserScript } from 'vite-plugin-monkey';

const metadata: MonkeyUserScript = {
  name: 'Kingshot Troop Formation %',
  namespace: 'https://github.com/jaredcat/userscripts',
  version: '1.0.2',
  description:
    'Injects per-squad in-game formation preset percentages into the Bear and Vikings Split tables. Warns when any troop type falls below its preset target. Recomputes Training Focus gap cells and explainer using Bear/Viking squad sliders (not fixed ×4). Persists inputs to localStorage across sessions.',
  match: ['https://www.kingshotguide.org/calculator/troops-calculator*'],
  grant: ['unsafeWindow'],
};

export default metadata;
