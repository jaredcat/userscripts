import type { MonkeyUserScript } from 'vite-plugin-monkey';

const metadata: MonkeyUserScript = {
  name: 'TVDB Episode Input Automation',
  version: '0.0.3',
  description: 'Automates episode input process on TVDB',
  match: ['*://thetvdb.com/series/*/episodes/add*'],
};
export default metadata;
