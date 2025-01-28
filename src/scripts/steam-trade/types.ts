export interface SteamTradeSettings {
  MESSAGE: string;
  AUTO_SEND: boolean;
  DO_AFTER_TRADE: string;
  ORDER: string;
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
  };
  DEFAULT_SETTINGS: SteamTradeSettings;
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
