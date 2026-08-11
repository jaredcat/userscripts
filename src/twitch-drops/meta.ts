import type { MonkeyUserScript } from 'vite-plugin-monkey';

const metadata: MonkeyUserScript = {
  name: 'Twitch Drops Page Tools',
  namespace: 'https://github.com/jaredcat/userscripts',
  version: '1.1.4',
  description:
    'Sort Twitch drops by end date, auto-claim inventory, and hide ended in-progress campaigns',
  match: ['*://www.twitch.tv/*'],
};

export default metadata;
