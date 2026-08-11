import type { MonkeyUserScript } from 'vite-plugin-monkey';

import toolkit from '../alienware-arena/meta.ts';

const toolkitInstallUrl =
  'https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/alienware-arena.user.js';

const metadata: MonkeyUserScript = {
  ...toolkit,
  // After this file is applied as an update, managers follow these URLs.
  updateURL: toolkitInstallUrl,
  downloadURL: toolkitInstallUrl,
  version: '1.9.9',
};

export default metadata;

/**
 * Legacy install URL — keep out of the collection README.
 */
export const isListedInReadme = false;
