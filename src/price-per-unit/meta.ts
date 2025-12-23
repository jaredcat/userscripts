import { MonkeyUserScript } from 'vite-plugin-monkey';

const metadata: MonkeyUserScript = {
  name: 'Price Per Unit',
  version: '1.0.2',
  description:
    'Adds price per unit to product pages and enables sorting by unit price',
  match: ['*://*.petsmart.com/*'],
};

export default metadata;
