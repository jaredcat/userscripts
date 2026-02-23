import { ChewyPricePerUnit } from './Chewy';
import { PetSmartPricePerUnit } from './PetSmart';

const SITE_HANDLERS = [
  {
    matcher: (url: string) => url.includes('petsmart.com'),
    handler: PetSmartPricePerUnit,
  },
  {
    matcher: (url: string) => url.includes('chewy.com'),
    handler: ChewyPricePerUnit,
  },
];

// Development hot reload
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}

// Find and initialize the appropriate handler for current site
const currentHandler = SITE_HANDLERS.find(({ matcher }) =>
  matcher(window.location.href),
);

if (currentHandler) {
  new currentHandler.handler().initialize().catch(console.error);
}
