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
    INVENTORY_CHECK_TIMEOUT: number;
    INVENTORY_CHECK_MAX_RETRIES: number;
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
  ToggleReady: (ready: boolean) => void;
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
}

// Add interfaces for Steam user and inventory types
export interface SteamUser {
  rgContexts: {
    [appId: number]: {
      [contextId: number]: {
        inventory: SteamInventory;
      };
    };
  };
  cLoadsInFlight: number;
  loadInventory: (appId: number, contextId: number) => void;
}

export interface SteamInventory {
  rgInventory: {
    [key: string]: SteamItem;
  };
  BuildInventoryDisplayElements: () => void;
}

export interface SteamItem {
  classid: string;
  type: string;
  element: HTMLElement;
  id: string;
}
