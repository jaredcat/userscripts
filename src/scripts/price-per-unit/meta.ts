import { UserScriptMetadata } from '../../types';

const metadata: UserScriptMetadata = {
  name: 'Price Per Unit',
  version: '1.0.0',
  description:
    'Adds price per unit to product pages and enables sorting by unit price',
  match: ['*://*.petsmart.com/*'],
  run_at: 'document-idle',
};

export default metadata;
