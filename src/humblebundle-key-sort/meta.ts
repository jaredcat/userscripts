import type { MonkeyUserScript } from 'vite-plugin-monkey';

const metadata: MonkeyUserScript = {
  name: 'Humble Bundle Key Sort',
  version: '2.0.0',
  description:
    'Steam redeem links with keys filled in; hide DRM-free in library filters',
  match: [
    '*://www.humblebundle.com/home/library',
    '*://www.humblebundle.com/home/library/*',
  ],
  grant: 'none',
};

export default metadata;
