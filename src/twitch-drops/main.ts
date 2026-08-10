import { initializeCampaigns } from './campaigns';
import { initializeInventory } from './inventory';

// Development hot reload
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    location.reload();
  });
}

const url = location.href;

// Initialize campaigns page handler
if (url.includes('/drops/campaigns')) {
  initializeCampaigns();
}

// Initialize inventory page handler
if (url.includes('/drops/inventory')) {
  initializeInventory();
}
