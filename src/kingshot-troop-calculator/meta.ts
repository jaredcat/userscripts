import type { MonkeyUserScript } from 'vite-plugin-monkey';

const metadata: MonkeyUserScript = {
  name: 'Kingshot Troop Formation %',
  namespace: 'https://github.com/jaredcat/userscripts',
  version: '1.2.0',
  description:
    'Bear table: subtractive simulation; Calculated % = composition per march vs preset goal warnings. Vikings: uniform best-fit. Training Focus.',
  match: ['https://www.kingshotguide.org/calculator/troops-calculator*'],
  grant: ['unsafeWindow'],
};

export default metadata;
