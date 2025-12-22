import { MonkeyUserScript } from 'vite-plugin-monkey';

const metadata: MonkeyUserScript = {
  name: 'SteamTrade Matcher Userscript',
  namespace: 'https://www.steamtradematcher.com',
  version: '2.1.3',
  author: 'Robou / Tithen-Firion / jaredcat',
  description:
    'Allows quicker trade offers by automatically adding cards as matched by SteamTrade Matcher',
  match: [
    '*://steamcommunity.com/tradeoffer/new/*source=stm*',
    '*://*.steamtradematcher.com/*',
  ],
  connect: ['steamtradematcher.com'],
  icon: 'https://www.steamtradematcher.com/favicon.png',
  require: 'https://greasemonkey.github.io/gm4-polyfill/gm4-polyfill.js',
};

export default metadata;
