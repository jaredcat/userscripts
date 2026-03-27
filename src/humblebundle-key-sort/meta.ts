import type { MonkeyUserScript } from 'vite-plugin-monkey';

const metadata: MonkeyUserScript = {
  name: 'Humble Bundle Key Sort',
  version: '1.0.1',
  description: 'Sort Humble Bundle by claimed status',
  match: [
    '*://www.humblebundle.com/membership/*',
    '*://www.humblebundle.com/downloads?key=*',
  ],
};

export default metadata;
