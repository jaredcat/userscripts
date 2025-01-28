import { PetSmartPricePerUnit } from './PetSmart';

const SITE_HANDLERS = [
  {
    matcher: (url: string) => url.includes('petsmart.com'),
    handler: PetSmartPricePerUnit,
  },
  // Add future sites here like:
  // {
  //   matcher: (url: string) => url.includes('somestore.com'),
  //   handler: SomeStorePricePerUnit,
  // },
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
  new currentHandler.handler().initialize();
}
