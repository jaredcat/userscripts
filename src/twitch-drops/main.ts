import { initializeCampaigns } from './campaigns';

// Development hot reload
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}

const url = window.location.href;

// Initialize campaigns page handler
if (url.includes('/drops/campaigns')) {
  initializeCampaigns();
}

// Future: Initialize inventory page handler
// if (url.includes('/drops/inventory')) {
//   initializeInventory();
// }
