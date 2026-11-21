import type { MonkeyUserScript } from 'vite-plugin-monkey';

const metadata: MonkeyUserScript = {
  name: 'SteamTrade Matcher Userscript',
  namespace: 'https://www.steamtradematcher.com',
  version: '2.4.0',
  author: 'Robou / Tithen-Firion / jaredcat',
  description:
    'Allows quicker trade offers by automatically adding cards as matched by SteamTrade Matcher',
  match: [
    '*://steamcommunity.com/tradeoffer/new/*source=stm*',
    '*://*.steamtradematcher.com/*',
  ],
  connect: ['steamtradematcher.com', 'steamcommunity.com'],
  icon: 'https://www.steamtradematcher.com/favicon.png',
};

export default metadata;
