import type { MonkeyUserScript } from 'vite-plugin-monkey';

const metadata: MonkeyUserScript = {
  name: 'Alienware Arena Toolkit',
  namespace: 'https://github.com/jaredcat/userscripts',
  version: '2.0.0',
  description:
    'Artifact Optimizer, Control Center tasks, giveaway/vault filters, and UCF reading mode',
  match: ['*://*.alienwarearena.com/*'],
  connect: ['store.steampowered.com', 'raw.githubusercontent.com'],
  'run-at': 'document-start',
};

export default metadata;
