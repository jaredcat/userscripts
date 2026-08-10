import { BaseSiteHandler } from './BaseSiteHandler';
import type { ProductInfo } from './types';
import {
  createPricePerUnitElement,
  formatPricePerUnit,
  parsePrice,
  parseSize,
} from './utilities';

declare const unsafeWindow: Window | undefined;

/**
Product + ppu from Chewy PLP API (products[].ppu is e.g. "$0.69/lb")
*/
interface ChewyPlpProduct {
  catalogEntryId: number;
  parentCatalogEntryId: string;
  partNumber: string;
  ppu: string | undefined;
  href?: string | undefined;
  /**
  Id from /dp/XXX or parentCatalogEntryId, used to match DOM card
  */
  linkId: string;
}

interface ChewyPlpSearchResponse {
  products?: Record<string, unknown>[];
}

const IS_DEBUG = (() => {
  try {
    return localStorage.getItem('ppu-debug') === '1';
  } catch {
    return false;
  }
})();
const LOG = (message: string, ...arguments_: unknown[]) => {
  if (IS_DEBUG) console.log('[price-per-unit Chewy]', message, ...arguments_);
};

const PRODUCT_PAGE_WAIT_MS = 800;
const LISTING_PAGE_WAIT_MS = 1200;
const WAIT_FOR_MAIN_MAX_MS = 10_000;
const WAIT_FOR_MAIN_INTERVAL_MS = 200;
const DP_PATH_PATTERN = /\/dp\/([^/?#]+)/;
const GROUP_ID_PATTERN = /-(\d+)$/;

function isChewyPlpSearchResponse(
  value: unknown,
): value is ChewyPlpSearchResponse {
  if (typeof value !== 'object' || !value) return false;
  if (!('products' in value)) return true;
  return Array.isArray((value as ChewyPlpSearchResponse).products);
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function asString(value: unknown, fallback = ''): string {
  return asOptionalString(value) ?? fallback;
}

export class ChewyPricePerUnit extends BaseSiteHandler {
  private static readonly LISTING_PAGE_INDICATOR = [
    '[data-testid="product-listing"]',
    '.productlisting_container',
    '[class*="ProductListing"]',
    'main [class*="browse"]',
  ].join(', ');

  /**
  Link to product page: href contains /dp/{id} or /dp/{slug}
  */
  private static readonly CARD_LINK_SELECTOR = 'a[href*="/dp/"]';

  private static readonly GRID_CONTAINER_SELECTOR =
    '[class*="ProductListingGrid_gridContainer"]';
  private static readonly PRODUCT_CARD_SELECTOR =
    '.kib-product-card[data-category]:not(.js-tracked-ad-product)';
  private static readonly DESKTOP_SORT_SELECTOR =
    '[class*="ProductListingGrid_resultsSort"]';

  private static readonly PRICE_IN_CARD = [
    '[data-testid*="price"]',
    '.price',
    '[class*="Price"]',
    'span[class*="price"]',
  ].join(', ');

  private static readonly SIZE_IN_CARD = [
    '[data-testid*="size"]',
    '.size',
    '[class*="Size"]',
    '[class*="weight"]',
    '.product-size',
    'span[class*="size"]',
  ].join(', ');

  private static mapPlpProduct(
    product: Record<string, unknown>,
  ): ChewyPlpProduct {
    const href = asOptionalString(product.href);
    const dpMatch = href ? DP_PATH_PATTERN.exec(href) : undefined;
    return {
      catalogEntryId: Number(product.catalogEntryId),
      parentCatalogEntryId: asString(product.parentCatalogEntryId),
      partNumber: asString(product.partNumber),
      ppu: asOptionalString(product.ppu),
      href,
      linkId:
        dpMatch?.[1] ??
        asString(product.parentCatalogEntryId ?? product.catalogEntryId),
    };
  }

  /**
  Cached products from last /plp/api/search response for sort-by-ppu
  */
  private plpProducts: ChewyPlpProduct[] = [];

  /**
  Real page window (for fetch intercept and credentialed requests in sandboxed engines).
  */
  private get targetWindow(): Window {
    return (unsafeWindow ?? globalThis) as Window;
  }

  private isListingPage(): boolean {
    return (
      /\/b\/[^/]+/i.test(location.pathname) ||
      !!document.querySelector(ChewyPricePerUnit.LISTING_PAGE_INDICATOR)
    );
  }

  private async addPricePerUnitOnProductPage() {
    await this.waitForStable(PRODUCT_PAGE_WAIT_MS);

    const container =
      document.querySelector('[data-testid="product-detail"]') ??
      document.querySelector('.product-detail') ??
      document.querySelector('[class*="ProductDetail"]') ??
      document.querySelector('main');
    if (!container) return;

    const priceContainer =
      container.querySelector(ChewyPricePerUnit.PRICE_IN_CARD) ??
      container.querySelector('.price');
    if (!priceContainer) return;

    this.createObserver(container, priceContainer, (element) =>
      priceContainer.append(element),
    );

    const productInfo = this.extractProductInfo(container);
    if (!productInfo?.pricePerUnit) return;

    const element = createPricePerUnitElement(
      formatPricePerUnit(productInfo.pricePerUnit, productInfo.unit),
    );
    priceContainer.append(element);
  }

  private findDesktopSortContainer(): Element | undefined {
    const sortSelect = document.querySelector('[class*="Sort_sortSelect"]');
    if (sortSelect?.parentElement) return sortSelect.parentElement;
    return (
      document.querySelector(ChewyPricePerUnit.DESKTOP_SORT_SELECTOR) ??
      undefined
    );
  }

  private createSortButtonsFragment(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.style.display = 'inline-flex';
    wrap.dataset.pricePerUnitSort = '1';
    const buttonAsc = document.createElement('button');
    buttonAsc.type = 'button';
    buttonAsc.textContent = 'Unit price ↑';
    buttonAsc.style.cssText = 'margin-left:8px;cursor:pointer;padding:4px 8px;';
    buttonAsc.addEventListener('click', () =>
      this.sortListingByUnitPrice('asc'),
    );
    const buttonDesc = document.createElement('button');
    buttonDesc.type = 'button';
    buttonDesc.textContent = 'Unit price ↓';
    buttonDesc.style.cssText =
      'margin-left:4px;cursor:pointer;padding:4px 8px;';
    buttonDesc.addEventListener('click', () =>
      this.sortListingByUnitPrice('desc'),
    );
    wrap.append(buttonAsc, buttonDesc);
    return wrap;
  }

  private async waitForMainThenAddSort(): Promise<void> {
    const deadline = Date.now() + WAIT_FOR_MAIN_MAX_MS;
    const readySelector = `${ChewyPricePerUnit.GRID_CONTAINER_SELECTOR}, ${ChewyPricePerUnit.DESKTOP_SORT_SELECTOR}`;
    while (!document.querySelector(readySelector) && Date.now() < deadline) {
      await new Promise((resolve) =>
        setTimeout(resolve, WAIT_FOR_MAIN_INTERVAL_MS),
      );
    }
    if (!document.querySelector(readySelector)) {
      LOG('waitForMainThenAddSort: grid never appeared');
    }
    await this.addSortByUnitPriceOnListingPage();
  }

  private async addSortByUnitPriceOnListingPage() {
    await this.waitForStable(LISTING_PAGE_WAIT_MS);

    const desktopContainer = this.findDesktopSortContainer();
    const mobileContainer = document.querySelector(
      '[class*="MobileSortAndFacetControls_sortFilter"]',
    );
    LOG(
      'addSortByUnitPrice: desktopContainer=',
      !!desktopContainer,
      'mobileContainer=',
      !!mobileContainer,
    );

    if (
      desktopContainer &&
      !desktopContainer.querySelector('[data-price-per-unit-sort="1"]')
    ) {
      desktopContainer.append(this.createSortButtonsFragment());
      LOG('addSortByUnitPrice: injected into desktop container');
    }
    if (
      mobileContainer &&
      !mobileContainer.querySelector('[data-price-per-unit-sort="1"]')
    ) {
      mobileContainer.append(this.createSortButtonsFragment());
      LOG('addSortByUnitPrice: injected into mobile container');
    }
    if (!desktopContainer && !mobileContainer) {
      const grid = document.querySelector(
        ChewyPricePerUnit.GRID_CONTAINER_SELECTOR,
      );
      if (grid) {
        grid.insertAdjacentElement(
          'beforebegin',
          this.createSortButtonsFragment(),
        );
      } else {
        document.body.append(this.createSortButtonsFragment());
      }
      LOG('addSortByUnitPrice: fallback inject');
    }
  }

  private resolveFetchUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (input instanceof Request) return input.url;
    return input.href;
  }

  private productsFromPlpJson(json: unknown): ChewyPlpProduct[] | undefined {
    if (!isChewyPlpSearchResponse(json) || !Array.isArray(json.products)) {
      return undefined;
    }
    return json.products.map((product) =>
      ChewyPricePerUnit.mapPlpProduct(product),
    );
  }

  private interceptPlpFetch() {
    const win = this.targetWindow;
    const originalFetch = win.fetch.bind(win);
    win.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = this.resolveFetchUrl(input);
      const response = await originalFetch(input, init);
      if (url.includes('/plp/api/search')) {
        try {
          const json: unknown = await response.clone().json();
          const products = this.productsFromPlpJson(json);
          if (products) this.plpProducts = products;
        } catch (error) {
          LOG('interceptPlpFetch: failed to parse response', error);
        }
      }
      return response;
    };
  }

  private parsePpu(ppu: string | undefined): number | undefined {
    if (ppu === undefined) return undefined;
    const match = /\$?([\d.]+)/.exec(ppu);
    const number_ = match?.[1];
    return number_ === undefined ? undefined : Number(number_);
  }

  private getProductIdFromCard(card: Element): string | undefined {
    if (card instanceof HTMLElement) {
      const category = card.dataset.category;
      if (category) return category;
    }
    const anchor = card.querySelector<HTMLAnchorElement>(
      ChewyPricePerUnit.CARD_LINK_SELECTOR,
    );
    if (!anchor?.href) return undefined;
    const match = DP_PATH_PATTERN.exec(anchor.href);
    return match?.[1];
  }

  private async ensurePlpProducts(): Promise<boolean> {
    if (this.plpProducts.length > 0) return true;
    const match = GROUP_ID_PATTERN.exec(location.pathname);
    const groupId = match?.[1];
    if (!groupId) return false;
    const url = `https://www.chewy.com/plp/api/search?catalogId=1004&count=36&from=0&sort=byRelevance&groupId=${groupId}`;
    try {
      const response = await this.targetWindow.fetch(url, {
        credentials: 'include',
      });
      const json: unknown = await response.json();
      const products = this.productsFromPlpJson(json);
      if (products) {
        this.plpProducts = products;
        return true;
      }
    } catch (error) {
      LOG('ensurePlpProducts: fetch failed', error);
    }
    return false;
  }

  private async sortListingByUnitPrice(order: 'asc' | 'desc') {
    LOG('sortListingByUnitPrice', order, 'start');

    const gridContainer = document.querySelector(
      ChewyPricePerUnit.GRID_CONTAINER_SELECTOR,
    );
    if (!gridContainer) {
      LOG('sortListingByUnitPrice: grid container not found, abort');
      return;
    }

    const cards = [
      ...gridContainer.querySelectorAll<HTMLElement>(
        ChewyPricePerUnit.PRODUCT_CARD_SELECTOR,
      ),
    ];
    LOG('sortListingByUnitPrice: cards.length', cards.length);
    if (cards.length === 0) return;

    // Build API PPU lookup (if intercepted data is available)
    const apiPpuById = new Map<string, number>();
    await this.ensurePlpProducts();
    for (const product of this.plpProducts) {
      const ppu = this.parsePpu(product.ppu);
      apiPpuById.set(product.linkId, ppu ?? Infinity);
    }

    const getPpu = (card: HTMLElement): number => {
      const id = this.getProductIdFromCard(card);
      if (id) {
        const fromApi = apiPpuById.get(id);
        if (fromApi !== undefined) return fromApi;
      }
      return this.parsePpu(card.dataset.pricePerUnit) ?? Infinity;
    };

    cards.sort((a, b) => {
      const ppuA = getPpu(a);
      const ppuB = getPpu(b);
      return order === 'asc' ? ppuA - ppuB : ppuB - ppuA;
    });

    LOG('sortListingByUnitPrice: reordering', cards.length, 'cards');
    for (const card of cards) {
      gridContainer.append(card);
    }
    LOG('sortListingByUnitPrice: done');
  }

  private async waitForStable(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  public async initialize() {
    this.interceptPlpFetch();
    if (this.isProductPage()) {
      await this.addPricePerUnitOnProductPage();
    } else if (this.isListingPage()) {
      await this.waitForMainThenAddSort();
    }
  }

  protected isProductPage(): boolean {
    return (
      /\/p\/[^/]+/i.test(location.pathname) ||
      !!document.querySelector(
        '[data-testid="product-detail"], .product-detail, [class*="ProductDetail"]',
      )
    );
  }

  protected extractProductInfo(element: Element): ProductInfo | undefined {
    const priceElement = element.querySelector(ChewyPricePerUnit.PRICE_IN_CARD);
    const sizeElement = element.querySelector(ChewyPricePerUnit.SIZE_IN_CARD);
    const priceText = (priceElement?.textContent ?? '').trim();
    const sizeText = (sizeElement?.textContent ?? '').trim();

    const price = parsePrice(priceText);
    if (!Number.isFinite(price)) return undefined;

    const sizeInfo = parseSize(sizeText);
    if (!sizeInfo) {
      const fromTitle =
        element.getAttribute('aria-label') ??
        element.querySelector('[class*="title"], [class*="name"]')
          ?.textContent ??
        '';
      const fromAny = parseSize(fromTitle || sizeText || priceText);
      if (!fromAny) return undefined;
      const pricePerUnit = price / fromAny.quantity;
      return {
        price,
        quantity: fromAny.quantity,
        unit: fromAny.unit,
        pricePerUnit,
      };
    }

    const pricePerUnit = price / sizeInfo.quantity;
    return {
      price,
      quantity: sizeInfo.quantity,
      unit: sizeInfo.unit,
      pricePerUnit,
    };
  }
}
