import { MonkeyUserScript } from 'vite-plugin-monkey';

const metadata: MonkeyUserScript = {
  name: 'Alienware Arena Filters',
  namespace: 'https://github.com/jaredcat/userscripts',
  version: '1.1.2',
  description:
    'Enhances Alienware Arena website with additional filtering options',
  match: ['*://*.alienwarearena.com/*'],
};

export default metadata;
