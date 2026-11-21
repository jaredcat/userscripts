/// <reference types="jquery" />
import type { GmResponseEvent } from '$';
import { GM, GM_xmlhttpRequest } from '$';
import type {
  CardOrder,
  DoAfterTrade,
  InventoryLoaderConfig,
  PickedCard,
  SteamAjaxTransport,
  SteamItem,
  SteamLoaderState,
  SteamLoaderWindow,
  SteamTradeConfig,
  SteamTradeSettings,
  SteamUser,
  SteamWindow,
} from './types';

// Cast unsafeWindow to SteamWindow type when using Steam-specific properties
declare const unsafeWindow: SteamWindow;
// Steam uses jQuery, so we need to declare it for type checking (callable, not module)
declare const $J: JQueryStatic;

const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MS_PER_DAY =
  HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const TRADE_PARTY_SIZE = 2;
const UINT32_RANGE = 4_294_967_296;

// STM-side inventory fetching (runs on steamtradematcher.com)
const INVENTORY_PAGE_SIZE = 2000;
const INVENTORY_PAGE_DELAY = 2000;
const INVENTORY_REQUEST_TIMEOUT = 30_000;

// Injected inventory loader (runs in the Steam trade page context)
const LOADER_CONFIG: InventoryLoaderConfig = {
  retryDelay: 45_000,
  maxRetries: 3,
};
const HTTP_OK = 200;

interface LoaderSide {
  status: 'loading' | 'waiting' | 'done' | 'failed';
  pages: number;
  items: number;
  retries: number;
  retryAt: number;
  error: string;
}

const CONFIG: SteamTradeConfig = {
  WEBSITE_HOSTS: ['www.steamtradematcher.com'],
  STEAM: {
    APP_ID: 753,
    CONTEXT_ID: 6,
  },
  TRADE: {
    CHUNK_SIZE: 150,
    // Stagger split windows so they don't all hammer Steam's inventory endpoint
    // at once (each window reloads the full inventory, which triggers 429s).
    WINDOW_DELAY: 20_000,
    INVENTORY_CHECK_INTERVAL: 500,
    INVENTORY_MAX_WAIT: 300_000,
    INVENTORY_STALL_TIMEOUT: 90_000,
  },
  COOKIE: {
    EXPIRY_DAYS: 15,
  },
  DEFAULT_SETTINGS: {
    MESSAGE: 'SteamTrade Matcher',
    AUTO_SEND: false,
    DO_AFTER_TRADE: 'NOTHING',
    ORDER: 'AS_IS',
    SIDE_BY_SIDE: false,
  },
  VALIDATION: {
    DO_AFTER_TRADE_VALUES: ['NOTHING', 'CLOSE_WINDOW', 'CLICK_OK'] as const,
    ORDER_VALUES: ['AS_IS', 'SORT', 'RANDOM'] as const,
    MESSAGE_MAX_LENGTH: 500,
  },
};

const SIDE_BY_SIDE_STYLE = `
  .pagecontent:has(> .trade_area ) {
    width: 100% !important;
  }
  .trade_area .inventory_ctn .inventory_page {
    width: auto !important;
    overflow-y: auto;
  }
  .trade_area {
    display: grid;
    grid-template-columns: minmax(200px, 458px) 1fr;
    gap: 10px 10px;
    padding: 0 20px;
    .inventory_user_tab {
      width: 49% !important;
    }
    .trade_box {
      width: 100% !important
    }
    .trade_left,
    .trade_left > .trade_box {
      box-sizing: border-box;
      height: fit-content;
      width: auto !important;
      max-width: 458px !important;
      float: none !important;
    }
    @media (min-height: 800px) {
      .trade_left {
        position: sticky !important;
        top: 0;
      }
    }
    div.appselect {
      width: auto !important;
    }
    #inventories,
    .inventory_ctn {
      width: auto !important;
    }
    .trade_right {
        float: none;
    }
    .offerheader {
      min-height: 71px;
      h2 {
        white-space: nowrap;
        max-width: 20ch;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }
    #your_slots,
    #their_slots {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
    }
    #your_slots {
      justify-content: flex-end;
    }
    #their_slots {
          justify-content: flex-start;
    }
    .trade_right .trade_box_contents{
      display: grid;
      grid-template-columns: 50% 50%;
      grid-template-rows:1fr 0fr;
      gap: 10px 10px;
      grid-template-areas:
        "yours theirs"
        "bottom bottom";
    }
    #trade_yours {
      grid-area: yours;
    }
    #trade_theirs {
      grid-area: theirs;
    }
    .trade_offer {
      display:flex;
      flex-direction: column;
    }
    #trade_items_separator,
    .trade_rule.maketrade{
      display: none;
      grid-area: bottom;
    }
    .trade_confirm_box{
      grid-area: bottom;
    }
  }
`;

const cookieDescriptor = Object.getOwnPropertyDescriptor(
  Document.prototype,
  'cookie',
);

function getDocumentCookie(): string {
  const cookie: unknown = cookieDescriptor?.get?.call(document);
  return typeof cookie === 'string' ? cookie : '';
}

function setDocumentCookie(value: string): void {
  cookieDescriptor?.set?.call(document, value);
}

function randomFloat(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  const value = buffer[0] ?? 0;
  return value / UINT32_RANGE;
}

class StyleManager {
  styleId = 'side-by-side-style';
  styleElement: HTMLStyleElement | undefined = undefined;
  isEnabled = false;

  async initialize() {
    this.isEnabled = await GM.getValue('SIDE_BY_SIDE', false);
    if (this.isEnabled) this.enableStyle();
  }

  enableStyle() {
    if (this.styleElement) {
      return;
    }

    this.styleElement = document.createElement('style');
    this.styleElement.id = this.styleId;
    this.styleElement.textContent = SIDE_BY_SIDE_STYLE;
    document.head.append(this.styleElement);
  }

  disableStyle() {
    if (!this.styleElement) {
      return;
    }

    this.styleElement.remove();
    this.styleElement = undefined;
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.getHTML();
}

function parseTradeItems(url: URL): { you: string[]; them: string[] } {
  const you = url.searchParams.getAll('you[]');
  const them = url.searchParams.getAll('them[]');
  if (you.length > 0 || them.length > 0) return { you, them };

  // Legacy format fallback (?you=a;b;c&them=d;e;f)
  const youLegacy = url.searchParams.get('you');
  const themLegacy = url.searchParams.get('them');
  return {
    you: youLegacy ? youLegacy.split(';') : [],
    them: themLegacy ? themLegacy.split(';') : [],
  };
}

function getUrlParameters(): {
  you: string[];
  them: string[];
  isGift: boolean;
} {
  const url = new URL(location.href);
  const isGift = url.searchParams.get('gift') === '1';
  return { ...parseTradeItems(url), isGift };
}

const CookieManager = {
  getInventoryCookie() {
    const match = /strTradeLastInventoryContext=([^;]+)/.exec(
      getDocumentCookie(),
    );
    return match?.[1];
  },

  clearInventoryCookie() {
    setDocumentCookie(
      'strTradeLastInventoryContext=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/tradeoffer/',
    );
  },

  restoreInventoryCookie(cookieValue: string | undefined) {
    if (!cookieValue) return;
    const expiry = new Date();
    expiry.setTime(expiry.getTime() + CONFIG.COOKIE.EXPIRY_DAYS * MS_PER_DAY);
    setDocumentCookie(
      `strTradeLastInventoryContext=${cookieValue}; expires=${expiry.toUTCString()}; path=/tradeoffer/`,
    );
  },
};

// Pick the actual inventory items that satisfy the requested classids,
// honoring the configured ordering (sorted / random / as-is).
function pickCards(
  settings: SteamTradeSettings,
  user: SteamUser,
  requestedCards: string[],
): PickedCard[] {
  const inventory =
    user.rgContexts[CONFIG.STEAM.APP_ID]?.[CONFIG.STEAM.CONTEXT_ID]?.inventory;
  if (!inventory) {
    throw new Error('Inventory is unavailable');
  }
  inventory.BuildInventoryDisplayElements();

  const available: Record<string, SteamItem[]> = {};
  const items = Object.values(inventory.rgInventory ?? {});
  for (const item of items) {
    if (!requestedCards.includes(item.classid)) {
      continue;
    }
    const bucket = (available[item.classid] ??= []);
    bucket.push(item);
  }

  if (settings.ORDER === 'SORT') {
    for (const cards of Object.values(available)) {
      cards.sort((a, b) => Number(b.id) - Number(a.id));
    }
  }

  const picked: PickedCard[] = [];
  for (const classId of requestedCards) {
    const cards = available[classId];
    if (!cards || cards.length === 0) {
      continue;
    }
    const index =
      settings.ORDER === 'RANDOM'
        ? Math.floor(randomFloat() * cards.length)
        : 0;
    const [card] = cards.splice(index, 1);
    if (card) {
      picked.push({ type: card.type, element: card.element, id: card.id });
    }
  }
  return picked;
}

function countByType(cards: PickedCard[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const card of cards) {
    counts[card.type] = (counts[card.type] ?? 0) + 1;
  }
  return counts;
}

// Trim both sides down so each card type is traded 1:1, dropping any extras
// that can no longer be matched on the other side.
function balanceByType(picked: PickedCard[][]): PickedCard[][] {
  const yourCounts = countByType(picked[0] ?? []);
  const theirCounts = countByType(picked[1] ?? []);

  const room: Record<string, number> = {};
  for (const [type, value] of Object.entries(yourCounts)) {
    room[type] = Math.min(value, theirCounts[type] ?? 0);
  }

  return picked.map((cards) => {
    const sideRoom: Record<string, number> = { ...room };
    return cards.filter((card) => {
      const remaining = sideRoom[card.type] ?? 0;
      sideRoom[card.type] = remaining - 1;
      return remaining > 0;
    });
  });
}

class TradeHandler {
  settings: SteamTradeSettings;
  users: SteamUser[];
  cards: string[][];
  isGift: boolean;

  constructor(
    settings: SteamTradeSettings,
    users: SteamUser[],
    cards: string[][],
    isGift: boolean,
  ) {
    this.settings = settings;
    this.users = users;
    this.cards = cards;
    this.isGift = isGift;
  }

  getUser(index: number): SteamUser {
    const user = this.users[index];
    if (!user) {
      throw new Error(`User at index ${String(index)} is undefined`);
    }
    return user;
  }

  addCards(): void {
    const requested = this.cards;
    const picked: PickedCard[][] = this.isGift
      ? [pickCards(this.settings, this.getUser(0), requested[0] ?? []), []]
      : requested.map((cards, index) =>
          pickCards(this.settings, this.getUser(index), cards),
        );

    const kept = this.isGift ? picked : balanceByType(picked);
    if ((kept[0]?.length ?? 0) === 0) {
      unsafeWindow.ShowAlertDialog(
        'Items missing',
        this.isGift
          ? 'None of the selected items are still in your inventory. Script aborting.'
          : 'None of the matched items are still available on both sides. Script aborting.',
      );
      throw new Error('Cards missing');
    }

    for (const cards of kept) {
      for (const card of cards) {
        unsafeWindow.MoveItemToTrade(card.element);
      }
    }

    if (!this.isGift) {
      const yourSlots = document.querySelectorAll('#your_slots .has_item');
      const theirSlots = document.querySelectorAll('#their_slots .has_item');
      if (yourSlots.length !== theirSlots.length) {
        unsafeWindow.ShowAlertDialog(
          'Not 1:1 trade',
          'This is not a valid 1:1 trade. Script aborting.',
        );
        throw new Error('Not 1:1 trade');
      }
    }

    const leftOut = requested.map(
      (cards, index) => cards.length - (kept[index]?.length ?? 0),
    );
    const yourLeftOut = leftOut[0] ?? 0;
    const theirLeftOut = leftOut[1] ?? 0;
    const isIncomplete = yourLeftOut > 0 || theirLeftOut > 0;
    if (isIncomplete) {
      unsafeWindow.ShowAlertDialog(
        'Items missing',
        this.isGift
          ? `${String(yourLeftOut)} of the selected item(s) are no longer in your inventory and were left out.`
          : `Some items are no longer available. ${String(yourLeftOut)} item(s) removed from each side.`,
      );
    }

    this.injectPostTradeHandler();

    if (isIncomplete || this.isGift || !this.settings.AUTO_SEND) {
      return;
    }

    unsafeWindow.ToggleReady(true);
    unsafeWindow.CTradeOfferStateManager.ConfirmTradeOffer();
  }

  injectPostTradeHandler() {
    if (this.settings.DO_AFTER_TRADE === 'NOTHING') return;

    const script = document.createElement('script');
    const action = JSON.stringify(this.settings.DO_AFTER_TRADE);
    script.textContent = `
      const DO_AFTER_TRADE = ${action};
      $J(document).ajaxSuccess((event, xhr, settings) => {
        if (settings.url === "https://steamcommunity.com/tradeoffer/new/send") {
          if (DO_AFTER_TRADE === "CLOSE_WINDOW") {
            window.close();
          } else if (DO_AFTER_TRADE === "CLICK_OK") {
            document.querySelector("div.newmodal_buttons > div")?.click();
          }
        }
      });
    `;
    document.body.append(script);
  }
}

// Runs in the Steam trade page context (injected as a <script>). It wraps
// Steam's own inventory loading functions to show load progress and to retry
// when Steam rate-limits (HTTP 429) the inventory endpoints. It must stay
// fully self-contained: it is serialized with toString() and executed in the
// page scope, so it cannot reference any module-level bindings.
function stmInventoryLoader(config: InventoryLoaderConfig): void {
  const w = globalThis as unknown as SteamLoaderWindow;
  const originalRequest = w.RequestFullInventory;
  const originalContinue = w.ContinueFullInventoryRequestIfNecessary;
  if (
    typeof originalRequest !== 'function' ||
    typeof originalContinue !== 'function'
  ) {
    return;
  }

  const SETTLE_DELAY = 1500;
  const RETRY_TICK = 1000;
  const MS = 1000;
  const TOO_MANY_REQUESTS = 429;
  const OK = 200;
  const LABELS: Record<string, string> = {
    you: 'Your inventory',
    them: 'Their inventory',
  };
  const sides: Record<string, LoaderSide> = {};
  const loader: SteamLoaderState = {
    failed: undefined,
    lastUpdate: Date.now(),
  };
  w.STM_INVENTORY_LOADER = loader;
  let box: HTMLDivElement | undefined;

  const describe = (side: LoaderSide): string => {
    switch (side.status) {
      case 'done': {
        return `done, ${String(side.items)} items`;
      }
      case 'failed': {
        return `<span style="color:#ff7b7b">failed (${side.error})</span>`;
      }
      case 'waiting': {
        const wait = Math.ceil(Math.max(0, side.retryAt - Date.now()) / MS);
        return `Steam is limiting requests, retrying page ${String(side.pages + 1)} in ${String(wait)} s (attempt ${String(side.retries)}/${String(config.maxRetries)})`;
      }
      default: {
        return `loading page ${String(side.pages + 1)}, ${String(side.items)} items so far`;
      }
    }
  };

  const render = (): void => {
    loader.lastUpdate = Date.now();
    if (!box) {
      box = document.createElement('div');
      box.style.cssText =
        'position:fixed;top:12px;right:12px;z-index:10000;max-width:360px;padding:10px 14px;' +
        'background:#1b2838;color:#c7d5e0;border:1px solid #66c0f4;border-radius:4px;' +
        'font:13px/1.5 Arial,Helvetica,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.6)';
      document.body.append(box);
    }

    const keys = Object.keys(sides);
    const lines = keys.map((key) => {
      const side = sides[key];
      return side ? `${LABELS[key] ?? key}: ${describe(side)}` : '';
    });
    box.innerHTML = [
      '<strong style="color:#fff">SteamTrade Matcher: loading inventories</strong>',
      ...lines,
    ].join('<br>');

    const isAllDone = (): boolean =>
      keys.every((key) => sides[key]?.status === 'done');
    if (!isAllDone()) {
      return;
    }
    setTimeout(() => {
      if (!box || !isAllDone()) {
        return;
      }
      box.remove();
      box = undefined;
    }, SETTLE_DELAY);
  };

  const retryLater = (side: LoaderSide, retry: () => void): void => {
    const remaining = side.retryAt - Date.now();
    render();
    if (remaining > 0) {
      setTimeout(retryLater, Math.min(RETRY_TICK, remaining), side, retry);
      return;
    }
    side.status = 'loading';
    render();
    retry();
  };

  w.RequestFullInventory = (...requestArguments: unknown[]): void => {
    const side = String(requestArguments[0]).includes('partnerinventory')
      ? 'them'
      : 'you';
    sides[side] = {
      status: 'loading',
      pages: 0,
      items: 0,
      retries: 0,
      retryAt: 0,
      error: '',
    };
    render();
    originalRequest.apply(globalThis, requestArguments);
  };

  w.ContinueFullInventoryRequestIfNecessary = (
    transport: SteamAjaxTransport,
    merged: unknown,
    url: string,
    parameters: unknown,
    ...callbacks: unknown[]
  ): void => {
    const key = url.includes('partnerinventory') ? 'them' : 'you';
    const side = sides[key];
    const proceed = (): void => {
      originalContinue.call(
        globalThis,
        transport,
        merged,
        url,
        parameters,
        ...callbacks,
      );
    };
    if (!side) {
      proceed();
      return;
    }

    const json = transport.responseJSON;
    if (json?.success) {
      side.pages += 1;
      side.retries = 0;
      side.items += Object.keys(json.rgInventory ?? {}).length;
      side.status = json.more ? 'loading' : 'done';
      render();
      proceed();
      return;
    }

    if (
      transport.status === TOO_MANY_REQUESTS &&
      side.retries < config.maxRetries
    ) {
      side.retries += 1;
      side.status = 'waiting';
      side.retryAt = Date.now() + config.retryDelay;
      retryLater(side, () => {
        // Ajax.Request performs the request as a constructor side effect.
        // eslint-disable-next-line sonarjs/constructor-for-side-effects
        new w.Ajax.Request(url, {
          method: 'get',
          parameters,
          onComplete: (retry: SteamAjaxTransport): void => {
            w.ContinueFullInventoryRequestIfNecessary?.(
              retry,
              merged,
              url,
              parameters,
              ...callbacks,
            );
          },
        });
      });
      return;
    }

    side.status = 'failed';
    side.error =
      transport.status === OK
        ? (json?.error ?? 'Steam returned no inventory')
        : `HTTP ${String(transport.status)}`;
    loader.failed = `${LABELS[key] ?? key} could not be loaded (${side.error}).`;
    render();
    proceed();
  };
}

function injectInventoryLoader(): void {
  const script = document.createElement('script');
  script.textContent = `(${stmInventoryLoader.toString()})(${JSON.stringify(LOADER_CONFIG)});`;
  document.body.append(script);
}

function gmRequest(details: {
  method: string;
  url: string;
  timeout: number;
}): Promise<GmResponseEvent<'text'>> {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      ...details,
      onload: resolve,
      onerror: () => {
        reject(new Error('Steam could not be reached'));
      },
      ontimeout: () => {
        reject(new Error('Steam did not answer in time'));
      },
    });
  });
}

// Fetch a user's full 753/6 inventory from steamcommunity.com, page by page,
// so steamtradematcher.com can read inventories without hitting CORS limits.
async function fetchInventoryPages(steamId: string): Promise<unknown[]> {
  const pages: unknown[] = [];
  let startAssetId: string | undefined;

  do {
    const appId = String(CONFIG.STEAM.APP_ID);
    const contextId = String(CONFIG.STEAM.CONTEXT_ID);
    const count = String(INVENTORY_PAGE_SIZE);
    let url = `https://steamcommunity.com/inventory/${steamId}/${appId}/${contextId}?l=english&count=${count}`;
    if (startAssetId) {
      url += `&start_assetid=${startAssetId}`;
      await new Promise((resolve) => {
        setTimeout(resolve, INVENTORY_PAGE_DELAY);
      });
    }

    const response = await gmRequest({
      method: 'GET',
      url,
      timeout: INVENTORY_REQUEST_TIMEOUT,
    });
    if (response.status !== HTTP_OK) {
      throw new Error(`Steam answered HTTP ${String(response.status)}`);
    }

    const page = JSON.parse(response.responseText) as {
      success?: number;
      more_items?: boolean;
      last_assetid?: string;
    };
    if (page.success !== 1) {
      throw new Error('Steam returned no inventory');
    }

    pages.push(page);
    startAssetId = page.more_items ? page.last_assetid : undefined;
  } while (startAssetId);

  return pages;
}

function scriptVersion(): string {
  return GM.info.script.version;
}

function listenToInventoryRequests(): void {
  document.documentElement.dataset.stmUserscriptInventory = '1';
  document.documentElement.dataset.stmUserscriptVersion = scriptVersion();

  document.addEventListener('stm:fetch-inventory', (event) => {
    void (async () => {
      const request = JSON.parse((event as CustomEvent<string>).detail) as {
        requestId: string;
        steamId: string;
      };
      const answer: {
        requestId: string;
        pages?: unknown[];
        error?: string;
      } = { requestId: request.requestId };

      try {
        answer.pages = await fetchInventoryPages(request.steamId);
      } catch (error) {
        answer.error = String(error instanceof Error ? error.message : error);
      }

      document.dispatchEvent(
        new CustomEvent('stm:inventory-fetched', {
          detail: JSON.stringify(answer),
        }),
      );
    })();
  });
}

class TradeSplitter {
  bindEvents() {
    document.addEventListener('click', (event) => {
      this.handleTradeClick(event);
    });
  }

  handleTradeClick(event: MouseEvent) {
    const tradeButton =
      (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>(
        '.user-results > .card-header > div > .btn',
      ) ?? undefined;
    if (!tradeButton) return;

    const url = new URL(tradeButton.href);
    const { you, them } = parseTradeItems(url);

    // STM packs every card into one tradeoffer URL. Large matches blow past
    // browser/server URL length limits, so we take over and open chunked
    // windows. Small trades stay with STM's native single-tab open.
    if (
      you.length <= CONFIG.TRADE.CHUNK_SIZE &&
      them.length <= CONFIG.TRADE.CHUNK_SIZE
    ) {
      return;
    }

    event.preventDefault();
    void this.splitTrade(url, you, them);
  }

  async splitTrade(
    baseUrl: URL,
    youParameters: string[],
    themParameters: string[],
  ) {
    const total = Math.max(youParameters.length, themParameters.length);
    for (let index = 0; index < total; index += CONFIG.TRADE.CHUNK_SIZE) {
      this.openTradeWindow(baseUrl, youParameters, themParameters, index);
      await new Promise((resolve) =>
        setTimeout(resolve, CONFIG.TRADE.WINDOW_DELAY),
      );
    }
  }

  openTradeWindow(
    baseUrl: string | URL,
    youParameters: string[],
    themParameters: string[],
    startIndex: number,
  ) {
    const newUrl = new URL(baseUrl);
    // Drop only the card lists; keep partner/token/source/gift/etc.
    newUrl.searchParams.delete('you[]');
    newUrl.searchParams.delete('them[]');
    newUrl.searchParams.delete('you');
    newUrl.searchParams.delete('them');

    const youChunk = youParameters.slice(
      startIndex,
      startIndex + CONFIG.TRADE.CHUNK_SIZE,
    );
    const themChunk = themParameters.slice(
      startIndex,
      startIndex + CONFIG.TRADE.CHUNK_SIZE,
    );

    for (const value of youChunk) newUrl.searchParams.append('you[]', value);
    for (const value of themChunk) newUrl.searchParams.append('them[]', value);

    window.open(newUrl.href, '_blank');
  }
}

function isValidDoAfterTrade(value: unknown): value is DoAfterTrade {
  return (
    typeof value === 'string' &&
    CONFIG.VALIDATION.DO_AFTER_TRADE_VALUES.includes(value as DoAfterTrade)
  );
}

function isValidCardOrder(value: unknown): value is CardOrder {
  return (
    typeof value === 'string' &&
    CONFIG.VALIDATION.ORDER_VALUES.includes(value as CardOrder)
  );
}

async function loadSettings(): Promise<SteamTradeSettings> {
  const settings = { ...CONFIG.DEFAULT_SETTINGS };

  const message = await GM.getValue('MESSAGE', CONFIG.DEFAULT_SETTINGS.MESSAGE);
  if (typeof message === 'string') {
    settings.MESSAGE = message;
  }

  const isAutoSend = await GM.getValue(
    'AUTO_SEND',
    CONFIG.DEFAULT_SETTINGS.AUTO_SEND,
  );
  if (typeof isAutoSend === 'boolean') {
    settings.AUTO_SEND = isAutoSend;
  }

  const doAfterTrade = await GM.getValue(
    'DO_AFTER_TRADE',
    CONFIG.DEFAULT_SETTINGS.DO_AFTER_TRADE,
  );
  if (isValidDoAfterTrade(doAfterTrade)) {
    settings.DO_AFTER_TRADE = doAfterTrade;
  }

  const order = await GM.getValue('ORDER', CONFIG.DEFAULT_SETTINGS.ORDER);
  if (isValidCardOrder(order)) {
    settings.ORDER = order;
  }

  const isSideBySide = await GM.getValue(
    'SIDE_BY_SIDE',
    CONFIG.DEFAULT_SETTINGS.SIDE_BY_SIDE,
  );
  if (typeof isSideBySide === 'boolean') {
    settings.SIDE_BY_SIDE = isSideBySide;
  }

  return settings;
}

async function saveSettings() {
  const messageInput =
    document.querySelector<HTMLInputElement>('#trade-message');
  const trimmedMessage = messageInput?.value.trim() ?? '';
  const message =
    trimmedMessage.length > 0
      ? trimmedMessage
      : CONFIG.DEFAULT_SETTINGS.MESSAGE;
  if (message.length > CONFIG.VALIDATION.MESSAGE_MAX_LENGTH) {
    throw new Error(
      `Message exceeds maximum length of ${String(CONFIG.VALIDATION.MESSAGE_MAX_LENGTH)} characters`,
    );
  }

  const doAfterTradeInput =
    document.querySelector<HTMLSelectElement>('#after-trade');
  const doAfterTrade = doAfterTradeInput?.value;
  if (!isValidDoAfterTrade(doAfterTrade)) {
    throw new Error(`Invalid DO_AFTER_TRADE value: ${String(doAfterTrade)}`);
  }

  const orderInput = document.querySelector<HTMLSelectElement>('#cards-order');
  const order = orderInput?.value;
  if (!isValidCardOrder(order)) {
    throw new Error(`Invalid ORDER value: ${String(order)}`);
  }

  const autoSendInput = document.querySelector<HTMLInputElement>('#auto-send');
  const isAutoSend =
    autoSendInput?.checked ?? CONFIG.DEFAULT_SETTINGS.AUTO_SEND;

  const sideBySideInput =
    document.querySelector<HTMLInputElement>('#side-by-side');
  const isSideBySide =
    sideBySideInput?.checked ?? CONFIG.DEFAULT_SETTINGS.SIDE_BY_SIDE;

  const settings: SteamTradeSettings = {
    MESSAGE: message,
    DO_AFTER_TRADE: doAfterTrade,
    ORDER: order,
    AUTO_SEND: isAutoSend,
    SIDE_BY_SIDE: isSideBySide,
  };

  await Promise.all(
    Object.entries(settings).map(([key, value]) => GM.setValue(key, value)),
  );

  const alert = document.querySelector<HTMLElement>('#alert');
  if (alert) {
    alert.style.display = 'block';
  }
  window.scroll(0, 0);
}

async function restoreDefaults() {
  if (!confirm('Restore default settings?')) return;
  await Promise.all(
    Object.keys(CONFIG.DEFAULT_SETTINGS).map((key) => GM.deleteValue(key)),
  );
  document.location.reload();
}

function createSettingsCard(title: string, body: string): string {
  return `
      <div class="col-xl-6 g-3">
        <div class="card border-dark h-100">
          <div class="card-header">${escapeHtml(title)}</div>
          <div class="card-body fw-light">${body}</div>
        </div>
      </div>
    `;
}

function createAfterTradeCard(settings: SteamTradeSettings): string {
  const selected = (value: DoAfterTrade) =>
    settings.DO_AFTER_TRADE === value ? 'selected' : '';
  return `
      <p>Determines what happens when you complete a trade offer.</p>
      <ul>
        <li><strong>Do nothing</strong>: Will do nothing more than the normal behavior.</li>
        <li><strong>Close window</strong>: Will close the window after the trade offer is sent.</li>
        <li><strong>Click OK</strong>: Will redirect you to the trade offers recap page.</li>
      </ul>
      <div class="option-block">
        <label for="after-trade">After trade...</label>
        <select class="form-control" name="after-trade" id="after-trade">
          <option value="NOTHING" ${selected('NOTHING')}>Do Nothing</option>
          <option value="CLOSE_WINDOW" ${selected('CLOSE_WINDOW')}>Close window</option>
          <option value="CLICK_OK" ${selected('CLICK_OK')}>Click OK</option>
        </select>
      </div>`;
}

function createOrderCard(settings: SteamTradeSettings): string {
  const selected = (value: CardOrder) =>
    settings.ORDER === value ? 'selected' : '';
  return `
      <p>Determines which card is added to trade.</p>
      <ul>
        <li><strong>Sorted</strong>: Will sort cards by their IDs before adding to trade.</li>
        <li><strong>Random</strong>: Will add cards to trade randomly.</li>
        <li><strong>As is</strong>: Script doesn't change anything in order.</li>
      </ul>
      <div class="option-block">
        <label for="cards-order">Cards order</label>
        <select class="form-control" name="cards-order" id="cards-order">
          <option value="SORT" ${selected('SORT')}>Sorted</option>
          <option value="RANDOM" ${selected('RANDOM')}>Random</option>
          <option value="AS_IS" ${selected('AS_IS')}>As is</option>
        </select>
      </div>`;
}

function createMessageCard(settings: SteamTradeSettings): string {
  return `
      <p>Custom text that will be included automatically with your trade offers.</p>
      <div>
        <input type="text" name="trade-message" id="trade-message" class="form-control" value="${escapeHtml(settings.MESSAGE)}">
      </div>`;
}

function createCheckboxCard(
  id: string,
  _title: string,
  description: string,
  isChecked: boolean,
): string {
  return `
      <p>${escapeHtml(description)}</p>
      <div class="checkbox form-check form-switch">
        <label for="${escapeHtml(id)}">
          <input name="${escapeHtml(id)}" class="form-check-input" id="${escapeHtml(id)}" value="1" type="checkbox" ${isChecked ? 'checked' : ''}>
          Enable
        </label>
      </div>`;
}

function createActionButtons(): string {
  return `
      <div class="position-fixed bottom-0 end-0 m-2 col-auto g-3">
        <div class="bg-opacity-25 bg-primary p-3 border border-primary rounded">
          <button class="btn btn-secondary border-dark me-2" id="restore" type="button">Restore default settings</button>
          <button class="btn btn-primary" id="save" type="button">Save</button>
        </div>
      </div>
    `;
}

async function handleSaveClick() {
  try {
    await saveSettings();
  } catch (error) {
    console.error('Failed to save settings:', error);
    const alert = document.querySelector<HTMLElement>('#alert');
    if (alert) {
      alert.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      alert.className = 'alert alert-danger mt-3 mb-0';
      alert.style.display = 'block';
    }
  }
}

function bindSettingsEventHandlers() {
  document.querySelector('#save')?.addEventListener('click', () => {
    void handleSaveClick();
  });
  document.querySelector('#restore')?.addEventListener('click', () => {
    void restoreDefaults();
  });
}

function toggleSettingsVisibility() {
  const userscriptSettings = document.querySelector<HTMLElement>(
    '#userscript-settings',
  );
  if (userscriptSettings) {
    userscriptSettings.style.display = 'block';
  }
  const userscriptGuide =
    document.querySelector<HTMLElement>('#userscript-guide');
  if (userscriptGuide) {
    userscriptGuide.style.display = 'none';
  }
}

function prepareSettings(settings: SteamTradeSettings) {
  const content = document.querySelector('#userscript-settings-target');
  if (!content) return;

  const cards: { title: string; body: string }[] = [
    {
      title: 'Action after trade',
      body: createAfterTradeCard(settings),
    },
    {
      title: 'Cards order',
      body: createOrderCard(settings),
    },
    {
      title: 'Trade offer message',
      body: createMessageCard(settings),
    },
    {
      title: 'Auto-send trade offer',
      body: createCheckboxCard(
        'auto-send',
        'Auto-send trade offer',
        'Makes it possible for the script to automatically send trade offers without any action.',
        settings.AUTO_SEND,
      ),
    },
    {
      title: 'Side-by-side trade view',
      body: createCheckboxCard(
        'side-by-side',
        'Side-by-side trade view',
        'Changes the steam trade window so that the trade columns are side-by-side.',
        settings.SIDE_BY_SIDE,
      ),
    },
  ];

  const cardElements = cards
    .map((card) => createSettingsCard(card.title, card.body))
    .join('');
  const buttons = createActionButtons();

  content.innerHTML = `
        <div class="alert alert-success mt-3 mb-0" id="alert" style="display:none">Your parameters have been saved.</div>
        ${cardElements}
        ${buttons}
        ${content.getHTML()}
    `;

  bindSettingsEventHandlers();
  toggleSettingsVisibility();
}

function getUserContext(user: SteamUser | undefined) {
  return user?.rgContexts[CONFIG.STEAM.APP_ID]?.[CONFIG.STEAM.CONTEXT_ID];
}

function getUserInventory(user: SteamUser | undefined) {
  return getUserContext(user)?.inventory;
}

function areInventoriesReady(users: SteamUser[]): boolean {
  return users.every((user) => {
    const inventory = getUserInventory(user);
    // Treat a missing or pending/placeholder inventory as not ready yet.
    if (!inventory || inventory.BIsPendingInventory?.()) {
      return false;
    }
    if (!inventory.rgInventory) {
      inventory.BuildInventoryDisplayElements();
    }
    return (
      Object.keys(inventory.rgInventory ?? {}).length > 0 &&
      user.cLoadsInFlight === 0
    );
  });
}

function requestMissingInventories(
  users: SteamUser[],
  requested: Set<number>,
): void {
  // Use an index loop rather than `users.entries()`: the array holds Steam
  // page objects (UserYou/UserThem), and on Firefox the entries() pairs get
  // wrapped across the userscript sandbox boundary and are not iterable.
  // eslint-disable-next-line unicorn/no-for-loop -- entries() breaks on Firefox here
  for (let index = 0; index < users.length; index++) {
    const user = users[index];
    if (!user || requested.has(index) || user.cLoadsInFlight !== 0) {
      continue;
    }

    // Steam registers each user's app contexts during its own page init. Until
    // that context exists, loadInventory() dereferences `rgContext.inventory` on
    // an undefined context and throws ("rgContext is undefined"), so wait for
    // Steam to register it rather than requesting the inventory prematurely.
    // Skip too once the inventory is already present (loaded or loading).
    const context = getUserContext(user);
    if (!context || context.inventory) {
      continue;
    }

    $J('#trade_inventory_unavailable').show();
    $J('#trade_inventory_pending').show();
    requested.add(index);
    user.loadInventory(CONFIG.STEAM.APP_ID, CONFIG.STEAM.CONTEXT_ID);
  }
}

async function waitForInventories(isGift: boolean): Promise<void> {
  const needed = isGift ? 1 : TRADE_PARTY_SIZE;
  const requested = new Set<number>();

  await new Promise<void>((resolve, reject) => {
    const startTime = Date.now();

    const checkInventories = () => {
      const loader = unsafeWindow.STM_INVENTORY_LOADER;

      // The loader gives up (after its own 429 retries) by setting `failed`.
      if (loader?.failed) {
        reject(
          new Error(
            `${loader.failed} Steam may be limiting requests: try again in a few minutes.`,
          ),
        );
        return;
      }

      const users = [unsafeWindow.UserYou, unsafeWindow.UserThem].slice(
        0,
        needed,
      );
      if (areInventoriesReady(users)) {
        resolve();
        return;
      }

      const now = Date.now();
      // Absolute ceiling so a genuinely stuck page can't hang forever.
      if (now - startTime > CONFIG.TRADE.INVENTORY_MAX_WAIT) {
        const maxWaitSeconds = Math.round(
          CONFIG.TRADE.INVENTORY_MAX_WAIT / MS_PER_SECOND,
        );
        reject(
          new Error(
            `Inventory loading timed out after ${String(maxWaitSeconds)}s`,
          ),
        );
        return;
      }

      // Be patient while the loader is still making progress. During a
      // rate-limit backoff it counts down to the next retry and refreshes
      // `lastUpdate` every second, so an active retry never looks stalled; we
      // bail only after a long stretch with no progress at all.
      const lastProgress = loader?.lastUpdate ?? startTime;
      if (now - lastProgress > CONFIG.TRADE.INVENTORY_STALL_TIMEOUT) {
        const stallSeconds = Math.round(
          CONFIG.TRADE.INVENTORY_STALL_TIMEOUT / MS_PER_SECOND,
        );
        reject(
          new Error(
            `Inventory loading stalled (no progress for ${String(stallSeconds)}s). Steam may be limiting requests: try again in a few minutes.`,
          ),
        );
        return;
      }

      requestMissingInventories(users, requested);
      setTimeout(checkInventories, CONFIG.TRADE.INVENTORY_CHECK_INTERVAL);
    };
    checkInventories();
  });
}

async function handleSteamTrade(settings: SteamTradeSettings) {
  const { you, them, isGift } = getUrlParameters();

  if (isGift && them.length > 0) {
    unsafeWindow.ShowAlertDialog(
      'Invalid gift',
      "A gift can't ask for items in return. Script aborting.",
    );
    throw new Error('Gift asking for items');
  }

  if (!isGift && you.length !== them.length) {
    unsafeWindow.ShowAlertDialog(
      'Different items amount',
      `You've requested ${you.length > them.length ? 'less' : 'more'} items than you give. Script aborting.`,
    );
    throw new Error('Different items amount on both sides');
  }

  if (you.length === 0) {
    throw new Error('No cards specified in URL parameters');
  }

  const oldCookie = CookieManager.getInventoryCookie();
  CookieManager.clearInventoryCookie();

  injectInventoryLoader();

  try {
    await waitForInventories(isGift);

    unsafeWindow.TradePageSelectInventory(
      unsafeWindow.UserYou,
      CONFIG.STEAM.APP_ID,
      CONFIG.STEAM.CONTEXT_ID.toString(),
    );
    const tradeOfferNote =
      document.querySelector<HTMLInputElement>('#trade_offer_note');
    if (tradeOfferNote) {
      tradeOfferNote.value = settings.MESSAGE;
    }

    const tradeHandler = new TradeHandler(
      settings,
      [unsafeWindow.UserYou, unsafeWindow.UserThem],
      [you, them],
      isGift,
    );
    tradeHandler.addCards();
  } catch (error) {
    if (error instanceof Error) {
      unsafeWindow.ShowAlertDialog('Trade Error', error.message);
      console.error('Trade error:', error);
    }
  } finally {
    CookieManager.restoreInventoryCookie(oldCookie);
  }
}

async function init() {
  const settings = await loadSettings();

  if (location.host === 'steamcommunity.com') {
    if (location.pathname.startsWith('/tradeoffer/new/')) {
      const styleManager = new StyleManager();
      await styleManager.initialize();
    }
    if (location.search.includes('source=stm')) {
      await handleSteamTrade(settings);
    }
  } else if (CONFIG.WEBSITE_HOSTS.includes(location.host)) {
    listenToInventoryRequests();
    const tradeSplitter = new TradeSplitter();
    tradeSplitter.bindEvents();
    document.addEventListener('turbo:load', () => {
      if (location.pathname === '/userscript') {
        prepareSettings(settings);
      }
    });
  }
}

try {
  await init();
} catch (error) {
  console.error(error);
}
