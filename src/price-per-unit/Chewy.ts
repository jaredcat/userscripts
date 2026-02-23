import { BaseSiteHandler } from './BaseSiteHandler';
import { ProductInfo } from './types';
import {
  createPricePerUnitElement,
  formatPricePerUnit,
  parseSize,
} from './utils';

declare const unsafeWindow: Window;

/** Product + ppu from Chewy PLP API (products[].ppu is e.g. "$0.69/lb") */
interface ChewyPlpProduct {
  catalogEntryId: number;
  parentCatalogEntryId: string;
  partNumber: string;
  ppu: string | null;
  href?: string | undefined;
  /** Id from /dp/XXX or parentCatalogEntryId, used to match DOM card */
  linkId: string;
}

const DEBUG = (() => {
  try { return localStorage.getItem('ppu-debug') === '1'; } catch { return false; }
})();
const LOG = (msg: string, ...args: unknown[]) => {
  if (DEBUG) console.log('[price-per-unit Chewy]', msg, ...args);
};

export class ChewyPricePerUnit extends BaseSiteHandler {
  /** Cached products from last /plp/api/search response for sort-by-ppu */
  private plpProducts: ChewyPlpProduct[] = [];

  private static readonly LISTING_PAGE_INDICATOR = [
    '[data-testid="product-listing"]',
    '.productlisting_container',
    '[class*="ProductListing"]',
    'main [class*="browse"]',
  ].join(', ');

  /** Link to product page: href contains /dp/{id} or /dp/{slug} */
  private static readonly CARD_LINK_SELECTOR = 'a[href*="/dp/"]';

  private static readonly GRID_CONTAINER_SELECTOR = '[class*="ProductListingGrid_gridContainer"]';
  private static readonly PRODUCT_CARD_SELECTOR = '.kib-product-card[data-category]:not(.js-tracked-ad-product)';
  private static readonly DESKTOP_SORT_SELECTOR = '[class*="ProductListingGrid_resultsSort"]';

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

  /** Real page window (for fetch intercept and credentialed requests in sandboxed engines). */
  private get targetWindow(): Window {
    return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
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
      /\/p\/[^/]+/i.test(window.location.pathname) ||
      !!document.querySelector('[data-testid="product-detail"], .product-detail, [class*="ProductDetail"]')
    );
  }

  private isListingPage(): boolean {
    return (
      /\/b\/[^/]+/i.test(window.location.pathname) ||
      !!document.querySelector(ChewyPricePerUnit.LISTING_PAGE_INDICATOR)
    );
  }

  protected extractProductInfo(element: Element): ProductInfo | null {
    const priceEl = element.querySelector(ChewyPricePerUnit.PRICE_IN_CARD);
    const sizeEl = element.querySelector(ChewyPricePerUnit.SIZE_IN_CARD);
    const priceText =
      (priceEl?.textContent ?? '').replace(/,/g, '').trim();
    const sizeText = (sizeEl?.textContent ?? '').trim();

    const priceMatch = priceText.match(/\$[\d,]+(?:\.\d{2})?/);
    const price = priceMatch
      ? parseFloat(priceMatch[0].replace(/[$,]/g, ''))
      : NaN;
    if (!Number.isFinite(price)) return null;

    const sizeInfo = parseSize(sizeText);
    if (!sizeInfo) {
      const fromTitle = element.getAttribute('aria-label') ?? (element.querySelector('[class*="title"], [class*="name"]')?.textContent ?? '');
      const fromAny = parseSize(fromTitle || sizeText || priceText);
      if (!fromAny) return null;
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

  private async addPricePerUnitOnProductPage() {
    await this.waitForStable(800);

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

    this.createObserver(container, priceContainer, (el) =>
      priceContainer.appendChild(el),
    );

    const productInfo = this.extractProductInfo(container);
    if (!productInfo?.pricePerUnit) return;

    const el = createPricePerUnitElement(
      formatPricePerUnit(productInfo.pricePerUnit, productInfo.unit),
    );
    priceContainer.appendChild(el);
  }

  private findDesktopSortContainer(): Element | null {
    const sortSelect = document.querySelector('[class*="Sort_sortSelect"]');
    if (sortSelect?.parentElement) return sortSelect.parentElement;
    return document.querySelector(ChewyPricePerUnit.DESKTOP_SORT_SELECTOR);
  }

  private createSortButtonsFragment(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.style.display = 'inline-flex';
    wrap.setAttribute('data-price-per-unit-sort', '1');
    const btnAsc = document.createElement('button');
    btnAsc.type = 'button';
    btnAsc.textContent = 'Unit price ↑';
    btnAsc.style.cssText = 'margin-left:8px;cursor:pointer;padding:4px 8px;';
    btnAsc.addEventListener('click', () => this.sortListingByUnitPrice('asc'));
    const btnDesc = document.createElement('button');
    btnDesc.type = 'button';
    btnDesc.textContent = 'Unit price ↓';
    btnDesc.style.cssText = 'margin-left:4px;cursor:pointer;padding:4px 8px;';
    btnDesc.addEventListener('click', () => this.sortListingByUnitPrice('desc'));
    wrap.append(btnAsc, btnDesc);
    return wrap;
  }

  private async waitForMainThenAddSort(): Promise<void> {
    const maxWait = 10000;
    const interval = 200;
    const deadline = Date.now() + maxWait;
    const readySelector = `${ChewyPricePerUnit.GRID_CONTAINER_SELECTOR}, ${ChewyPricePerUnit.DESKTOP_SORT_SELECTOR}`;
    while (!document.querySelector(readySelector) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
    }
    if (!document.querySelector(readySelector)) {
      LOG('waitForMainThenAddSort: grid never appeared');
    }
    await this.addSortByUnitPriceOnListingPage();
  }

  private async addSortByUnitPriceOnListingPage() {
    await this.waitForStable(1200);

    const desktopContainer = this.findDesktopSortContainer();
    const mobileContainer = document.querySelector('[class*="MobileSortAndFacetControls_sortFilter"]');
    LOG('addSortByUnitPrice: desktopContainer=', !!desktopContainer, 'mobileContainer=', !!mobileContainer);

    if (desktopContainer && !desktopContainer.querySelector('[data-price-per-unit-sort="1"]')) {
      desktopContainer.appendChild(this.createSortButtonsFragment());
      LOG('addSortByUnitPrice: injected into desktop container');
    }
    if (mobileContainer && !mobileContainer.querySelector('[data-price-per-unit-sort="1"]')) {
      mobileContainer.appendChild(this.createSortButtonsFragment());
      LOG('addSortByUnitPrice: injected into mobile container');
    }
    if (!desktopContainer && !mobileContainer) {
      const grid = document.querySelector(ChewyPricePerUnit.GRID_CONTAINER_SELECTOR);
      if (grid) {
        grid.insertAdjacentElement('beforebegin', this.createSortButtonsFragment());
      } else {
        document.body.appendChild(this.createSortButtonsFragment());
      }
      LOG('addSortByUnitPrice: fallback inject');
    }
  }

  private interceptPlpFetch() {
    const self = this;
    const win = this.targetWindow;
    const orig = win.fetch;
    win.fetch = function (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (typeof url === 'string' && url.includes('/plp/api/search')) {
        return orig.call(win, input, init).then(async (res) => {
          const clone = res.clone();
          try {
            const json = await clone.json();
            if (json?.products && Array.isArray(json.products)) {
              self.plpProducts = json.products.map(ChewyPricePerUnit.mapPlpProduct);
            }
          } catch (e) {
            LOG('interceptPlpFetch: failed to parse response', e);
          }
          return res;
        });
      }
      return orig.call(win, input, init);
    };
  }

  private static mapPlpProduct(p: Record<string, unknown>): ChewyPlpProduct {
    const href = p.href != null ? String(p.href) : undefined;
    const dpMatch = href?.match(/\/dp\/([^/?#]+)/);
    return {
      catalogEntryId: Number(p.catalogEntryId),
      parentCatalogEntryId: String(p.parentCatalogEntryId ?? ''),
      partNumber: String(p.partNumber ?? ''),
      ppu: p.ppu != null ? String(p.ppu) : null,
      href,
      linkId: dpMatch?.[1] ?? String(p.parentCatalogEntryId ?? p.catalogEntryId),
    };
  }

  private parsePpu(ppu: string | null): number | null {
    if (ppu == null) return null;
    const m = ppu.match(/\$?([\d.]+)/);
    const num = m?.[1];
    return num != null ? parseFloat(num) : null;
  }

  private getProductIdFromCard(card: Element): string | null {
    const cat = card.getAttribute('data-category');
    if (cat) return cat;
    const a = card.querySelector<HTMLAnchorElement>(ChewyPricePerUnit.CARD_LINK_SELECTOR);
    if (!a?.href) return null;
    const match = a.href.match(/\/dp\/([^/?#]+)/);
    return match?.[1] ?? null;
  }

  private async ensurePlpProducts(): Promise<boolean> {
    if (this.plpProducts.length > 0) return true;
    const m = window.location.pathname.match(/-(\d+)$/);
    const groupId = m ? m[1] : null;
    if (!groupId) return false;
    const url = `https://www.chewy.com/plp/api/search?catalogId=1004&count=36&from=0&sort=byRelevance&groupId=${groupId}`;
    try {
      const res = await this.targetWindow.fetch(url, { credentials: 'include' });
      const json = await res.json();
      if (json?.products && Array.isArray(json.products)) {
        this.plpProducts = json.products.map(ChewyPricePerUnit.mapPlpProduct);
        return true;
      }
    } catch (e) {
      LOG('ensurePlpProducts: fetch failed', e);
    }
    return false;
  }

  private async sortListingByUnitPrice(order: 'asc' | 'desc') {
    LOG('sortListingByUnitPrice', order, 'start');

    const gridContainer = document.querySelector(ChewyPricePerUnit.GRID_CONTAINER_SELECTOR);
    if (!gridContainer) {
      LOG('sortListingByUnitPrice: grid container not found, abort');
      return;
    }

    const cards = Array.from(
      gridContainer.querySelectorAll<HTMLElement>(ChewyPricePerUnit.PRODUCT_CARD_SELECTOR),
    );
    LOG('sortListingByUnitPrice: cards.length', cards.length);
    if (cards.length === 0) return;

    // Build API PPU lookup (if intercepted data is available)
    const apiPpuById = new Map<string, number>();
    await this.ensurePlpProducts();
    for (const p of this.plpProducts) {
      const ppu = this.parsePpu(p.ppu);
      apiPpuById.set(p.linkId, ppu ?? Number.POSITIVE_INFINITY);
    }

    const getPpu = (card: HTMLElement): number => {
      const id = this.getProductIdFromCard(card);
      if (id && apiPpuById.has(id)) return apiPpuById.get(id)!;
      const domPpu = card.getAttribute('data-price-per-unit');
      return this.parsePpu(domPpu) ?? Number.POSITIVE_INFINITY;
    };

    cards.sort((a, b) => {
      const ppuA = getPpu(a);
      const ppuB = getPpu(b);
      return order === 'asc' ? ppuA - ppuB : ppuB - ppuA;
    });

    LOG('sortListingByUnitPrice: reordering', cards.length, 'cards');
    for (const card of cards) {
      gridContainer.appendChild(card);
    }
    LOG('sortListingByUnitPrice: done');
  }

  private async waitForStable(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
