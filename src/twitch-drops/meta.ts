import { MonkeyUserScript } from 'vite-plugin-monkey';

const metadata: MonkeyUserScript = {
  name: 'Twitch Drops Page Tools',
  namespace: 'https://github.com/jaredcat/userscripts',
  version: '1.0.0',
  description: 'Sort Twitch drops by end date and add filtering checkboxes',
  match: [
    '*://www.twitch.tv/drops/campaigns*',
    '*://www.twitch.tv/drops/inventory*',
  ],
};

export default metadata;
