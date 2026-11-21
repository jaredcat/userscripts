export type DoAfterTrade = 'NOTHING' | 'CLOSE_WINDOW' | 'CLICK_OK';
export type CardOrder = 'AS_IS' | 'SORT' | 'RANDOM';

export interface SteamTradeSettings {
  MESSAGE: string;
  AUTO_SEND: boolean;
  DO_AFTER_TRADE: DoAfterTrade;
  ORDER: CardOrder;
  SIDE_BY_SIDE: boolean;
}

export interface SteamTradeConfig {
  WEBSITE_HOSTS: string[];
  STEAM: {
    APP_ID: number;
    CONTEXT_ID: number;
  };
  TRADE: {
    CHUNK_SIZE: number;
    WINDOW_DELAY: number;
    INVENTORY_CHECK_INTERVAL: number;
    // Absolute ceiling (ms) so a truly stuck page can't hang forever.
    INVENTORY_MAX_WAIT: number;
    // Give up only after the loader makes no progress for this long (ms). An
    // active rate-limit retry keeps updating progress, so it never counts as
    // stalled while it is still counting down to its next attempt.
    INVENTORY_STALL_TIMEOUT: number;
  };
  COOKIE: {
    EXPIRY_DAYS: number;
  };
  DEFAULT_SETTINGS: SteamTradeSettings;
  VALIDATION: {
    DO_AFTER_TRADE_VALUES: readonly DoAfterTrade[];
    ORDER_VALUES: readonly CardOrder[];
    MESSAGE_MAX_LENGTH: number;
  };
}

// Add interfaces for Steam-specific window properties
export interface SteamWindow extends Window {
  MoveItemToTrade: (element: HTMLElement) => void;
  ToggleReady: (isReady: boolean) => void;
  CTradeOfferStateManager: {
    ConfirmTradeOffer: () => void;
  };
  TradePageSelectInventory: (
    user: SteamUser,
    appId: number,
    contextId: string,
  ) => void;
  ShowAlertDialog: (title: string, message: string) => void;
  UserYou: SteamUser;
  UserThem: SteamUser;
  STM_INVENTORY_LOADER?: SteamLoaderState;
}

// Shared state exposed by the injected inventory loader
export interface SteamLoaderState {
  failed: string | undefined;
  // Epoch ms of the loader's most recent progress update. Lets the page's
  // wait loop tell "still working / retrying" apart from "genuinely stalled".
  lastUpdate?: number;
}

// Config passed to the injected inventory loader
export interface InventoryLoaderConfig {
  retryDelay: number;
  maxRetries: number;
}

// Response shape Steam's inventory endpoints return to the page's Ajax layer
export interface SteamAjaxTransport {
  status: number;
  responseJSON?: {
    success?: number | boolean;
    more?: boolean;
    rgInventory?: Record<string, unknown>;
    error?: string;
  };
}

// Page-context globals the injected inventory loader interacts with.
// Only used inside the injected (stringified) loader, which runs in the
// Steam page's own scope rather than the userscript sandbox.
export interface SteamLoaderWindow extends Window {
  RequestFullInventory?: (...arguments_: unknown[]) => void;
  ContinueFullInventoryRequestIfNecessary?: (
    transport: SteamAjaxTransport,
    merged: unknown,
    url: string,
    parameters: unknown,
    ...callbacks: unknown[]
  ) => void;
  Ajax: {
    Request: new (
      url: string,
      options: {
        method: string;
        parameters: unknown;
        onComplete: (transport: SteamAjaxTransport) => void;
      },
    ) => void;
  };
  STM_INVENTORY_LOADER?: SteamLoaderState;
}

// A single card selected for a trade, resolved to its Steam DOM element
export interface PickedCard {
  type: string;
  element: HTMLElement;
  id: string;
}

// Add interfaces for Steam user and inventory types
export interface SteamUser {
  rgContexts: Record<
    number,
    Record<
      number,
      {
        // Steam initializes contexts with `{ inventory: null }` and only later
        // replaces it with a real (or pending) inventory once loaded.
        inventory?: SteamInventory;
      }
    >
  >;
  cLoadsInFlight: number;
  loadInventory: (appId: number, contextId: number) => void;
}

export interface SteamInventory {
  rgInventory?: Record<string, SteamItem>;
  BuildInventoryDisplayElements: () => void;
  // Present on trade-page inventories; true for placeholder/loading inventories.
  BIsPendingInventory?: () => boolean;
}

export interface SteamItem {
  classid: string;
  type: string;
  element: HTMLElement;
  id: string;
}
