// ==UserScript==
// @name         Price Per Unit
// @namespace    jaredcat/price-per-unit
// @version      1.1.0
// @author       jaredcat
// @description  Adds price per unit to product pages and enables sorting by unit price
// @license      AGPL-3.0-or-later
// @downloadURL  https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/price-per-unit.user.js
// @updateURL    https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/price-per-unit.user.js
// @match        *://*.petsmart.com/*
// @match        *://*.chewy.com/*
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  function parseSize(sizeText) {
    const match = sizeText.match(/([\d.]+)[\s-]*(lb\.?s?|oz\.?|count|ct\.?|pack|pk\.?|each|ea\.?|g|kg|ml|L)\b/i);
    if (!match?.[1] || !match?.[2]) return null;
    const quantity = parseFloat(match[1]);
    const unit = match[2].toLowerCase().replace(/\.$/, "").trim();
    return { quantity, unit };
  }
  function formatPricePerUnit(price, unit) {
    const decimals = price < 0.01 ? 4 : price < 1 ? 3 : 2;
    return `$${price.toFixed(decimals)}/${unit}`;
  }
  function createPricePerUnitElement(text) {
    const element = document.createElement("div");
    element.className = "price-per-unit";
    element.style.cssText = `
    margin: 0 8px;
    color: red;
    font-size: 1em;
    font-family: monospace;
    font-weight: bold;
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
  `;
    element.textContent = text;
    return element;
  }
  class BaseSiteHandler {
    createObserver(container, priceContainer, onUpdate) {
      const observer = new MutationObserver(() => {
        const productInfo = this.extractProductInfo(container);
        if (!productInfo) return;
        if (productInfo.pricePerUnit === void 0) return;
        let pricePerUnitElement = priceContainer.querySelector(".price-per-unit");
        if (!pricePerUnitElement) {
          pricePerUnitElement = createPricePerUnitElement(
            formatPricePerUnit(productInfo.pricePerUnit, productInfo.unit)
          );
          onUpdate(pricePerUnitElement);
        } else {
          pricePerUnitElement.textContent = formatPricePerUnit(
            productInfo.pricePerUnit,
            productInfo.unit
          );
        }
        console.debug("Price per unit updated:", pricePerUnitElement.textContent);
      });
      observer.observe(priceContainer, {
        childList: true,
        subtree: true,
        characterData: true
      });
      return observer;
    }
  }
  const DEBUG = (() => {
    try {
      return localStorage.getItem("ppu-debug") === "1";
    } catch {
      return false;
    }
  })();
  const LOG = (msg, ...args) => {
    if (DEBUG) console.log("[price-per-unit Chewy]", msg, ...args);
  };
  class ChewyPricePerUnit extends BaseSiteHandler {
plpProducts = [];
    static LISTING_PAGE_INDICATOR = [
      '[data-testid="product-listing"]',
      ".productlisting_container",
      '[class*="ProductListing"]',
      'main [class*="browse"]'
    ].join(", ");
static CARD_LINK_SELECTOR = 'a[href*="/dp/"]';
    static GRID_CONTAINER_SELECTOR = '[class*="ProductListingGrid_gridContainer"]';
    static PRODUCT_CARD_SELECTOR = ".kib-product-card[data-category]:not(.js-tracked-ad-product)";
    static DESKTOP_SORT_SELECTOR = '[class*="ProductListingGrid_resultsSort"]';
    static PRICE_IN_CARD = [
      '[data-testid*="price"]',
      ".price",
      '[class*="Price"]',
      'span[class*="price"]'
    ].join(", ");
    static SIZE_IN_CARD = [
      '[data-testid*="size"]',
      ".size",
      '[class*="Size"]',
      '[class*="weight"]',
      ".product-size",
      'span[class*="size"]'
    ].join(", ");
get targetWindow() {
      return typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    }
    async initialize() {
      this.interceptPlpFetch();
      if (this.isProductPage()) {
        await this.addPricePerUnitOnProductPage();
      } else if (this.isListingPage()) {
        await this.waitForMainThenAddSort();
      }
    }
    isProductPage() {
      return /\/p\/[^/]+/i.test(window.location.pathname) || !!document.querySelector('[data-testid="product-detail"], .product-detail, [class*="ProductDetail"]');
    }
    isListingPage() {
      return /\/b\/[^/]+/i.test(window.location.pathname) || !!document.querySelector(ChewyPricePerUnit.LISTING_PAGE_INDICATOR);
    }
    extractProductInfo(element) {
      const priceEl = element.querySelector(ChewyPricePerUnit.PRICE_IN_CARD);
      const sizeEl = element.querySelector(ChewyPricePerUnit.SIZE_IN_CARD);
      const priceText = (priceEl?.textContent ?? "").replace(/,/g, "").trim();
      const sizeText = (sizeEl?.textContent ?? "").trim();
      const priceMatch = priceText.match(/\$[\d,]+(?:\.\d{2})?/);
      const price = priceMatch ? parseFloat(priceMatch[0].replace(/[$,]/g, "")) : NaN;
      if (!Number.isFinite(price)) return null;
      const sizeInfo = parseSize(sizeText);
      if (!sizeInfo) {
        const fromTitle = element.getAttribute("aria-label") ?? (element.querySelector('[class*="title"], [class*="name"]')?.textContent ?? "");
        const fromAny = parseSize(fromTitle || sizeText || priceText);
        if (!fromAny) return null;
        const pricePerUnit2 = price / fromAny.quantity;
        return {
          price,
          quantity: fromAny.quantity,
          unit: fromAny.unit,
          pricePerUnit: pricePerUnit2
        };
      }
      const pricePerUnit = price / sizeInfo.quantity;
      return {
        price,
        quantity: sizeInfo.quantity,
        unit: sizeInfo.unit,
        pricePerUnit
      };
    }
    async addPricePerUnitOnProductPage() {
      await this.waitForStable(800);
      const container = document.querySelector('[data-testid="product-detail"]') ?? document.querySelector(".product-detail") ?? document.querySelector('[class*="ProductDetail"]') ?? document.querySelector("main");
      if (!container) return;
      const priceContainer = container.querySelector(ChewyPricePerUnit.PRICE_IN_CARD) ?? container.querySelector(".price");
      if (!priceContainer) return;
      this.createObserver(
        container,
        priceContainer,
        (el2) => priceContainer.appendChild(el2)
      );
      const productInfo = this.extractProductInfo(container);
      if (!productInfo?.pricePerUnit) return;
      const el = createPricePerUnitElement(
        formatPricePerUnit(productInfo.pricePerUnit, productInfo.unit)
      );
      priceContainer.appendChild(el);
    }
    findDesktopSortContainer() {
      const sortSelect = document.querySelector('[class*="Sort_sortSelect"]');
      if (sortSelect?.parentElement) return sortSelect.parentElement;
      return document.querySelector(ChewyPricePerUnit.DESKTOP_SORT_SELECTOR);
    }
    createSortButtonsFragment() {
      const wrap = document.createElement("span");
      wrap.style.display = "inline-flex";
      wrap.setAttribute("data-price-per-unit-sort", "1");
      const btnAsc = document.createElement("button");
      btnAsc.type = "button";
      btnAsc.textContent = "Unit price ↑";
      btnAsc.style.cssText = "margin-left:8px;cursor:pointer;padding:4px 8px;";
      btnAsc.addEventListener("click", () => this.sortListingByUnitPrice("asc"));
      const btnDesc = document.createElement("button");
      btnDesc.type = "button";
      btnDesc.textContent = "Unit price ↓";
      btnDesc.style.cssText = "margin-left:4px;cursor:pointer;padding:4px 8px;";
      btnDesc.addEventListener("click", () => this.sortListingByUnitPrice("desc"));
      wrap.append(btnAsc, btnDesc);
      return wrap;
    }
    async waitForMainThenAddSort() {
      const maxWait = 1e4;
      const interval = 200;
      const deadline = Date.now() + maxWait;
      const readySelector = `${ChewyPricePerUnit.GRID_CONTAINER_SELECTOR}, ${ChewyPricePerUnit.DESKTOP_SORT_SELECTOR}`;
      while (!document.querySelector(readySelector) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, interval));
      }
      if (!document.querySelector(readySelector)) {
        LOG("waitForMainThenAddSort: grid never appeared");
      }
      await this.addSortByUnitPriceOnListingPage();
    }
    async addSortByUnitPriceOnListingPage() {
      await this.waitForStable(1200);
      const desktopContainer = this.findDesktopSortContainer();
      const mobileContainer = document.querySelector('[class*="MobileSortAndFacetControls_sortFilter"]');
      LOG("addSortByUnitPrice: desktopContainer=", !!desktopContainer, "mobileContainer=", !!mobileContainer);
      if (desktopContainer && !desktopContainer.querySelector('[data-price-per-unit-sort="1"]')) {
        desktopContainer.appendChild(this.createSortButtonsFragment());
        LOG("addSortByUnitPrice: injected into desktop container");
      }
      if (mobileContainer && !mobileContainer.querySelector('[data-price-per-unit-sort="1"]')) {
        mobileContainer.appendChild(this.createSortButtonsFragment());
        LOG("addSortByUnitPrice: injected into mobile container");
      }
      if (!desktopContainer && !mobileContainer) {
        const grid = document.querySelector(ChewyPricePerUnit.GRID_CONTAINER_SELECTOR);
        if (grid) {
          grid.insertAdjacentElement("beforebegin", this.createSortButtonsFragment());
        } else {
          document.body.appendChild(this.createSortButtonsFragment());
        }
        LOG("addSortByUnitPrice: fallback inject");
      }
    }
    interceptPlpFetch() {
      const self = this;
      const win = this.targetWindow;
      const orig = win.fetch;
      win.fetch = function(input, init) {
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
        if (typeof url === "string" && url.includes("/plp/api/search")) {
          return orig.call(win, input, init).then(async (res) => {
            const clone = res.clone();
            try {
              const json = await clone.json();
              if (json?.products && Array.isArray(json.products)) {
                self.plpProducts = json.products.map(ChewyPricePerUnit.mapPlpProduct);
              }
            } catch (e) {
              LOG("interceptPlpFetch: failed to parse response", e);
            }
            return res;
          });
        }
        return orig.call(win, input, init);
      };
    }
    static mapPlpProduct(p) {
      const href = p.href != null ? String(p.href) : void 0;
      const dpMatch = href?.match(/\/dp\/([^/?#]+)/);
      return {
        catalogEntryId: Number(p.catalogEntryId),
        parentCatalogEntryId: String(p.parentCatalogEntryId ?? ""),
        partNumber: String(p.partNumber ?? ""),
        ppu: p.ppu != null ? String(p.ppu) : null,
        href,
        linkId: dpMatch?.[1] ?? String(p.parentCatalogEntryId ?? p.catalogEntryId)
      };
    }
    parsePpu(ppu) {
      if (ppu == null) return null;
      const m = ppu.match(/\$?([\d.]+)/);
      const num = m?.[1];
      return num != null ? parseFloat(num) : null;
    }
    getProductIdFromCard(card) {
      const cat = card.getAttribute("data-category");
      if (cat) return cat;
      const a = card.querySelector(ChewyPricePerUnit.CARD_LINK_SELECTOR);
      if (!a?.href) return null;
      const match = a.href.match(/\/dp\/([^/?#]+)/);
      return match?.[1] ?? null;
    }
    async ensurePlpProducts() {
      if (this.plpProducts.length > 0) return true;
      const m = window.location.pathname.match(/-(\d+)$/);
      const groupId = m ? m[1] : null;
      if (!groupId) return false;
      const url = `https://www.chewy.com/plp/api/search?catalogId=1004&count=36&from=0&sort=byRelevance&groupId=${groupId}`;
      try {
        const res = await this.targetWindow.fetch(url, { credentials: "include" });
        const json = await res.json();
        if (json?.products && Array.isArray(json.products)) {
          this.plpProducts = json.products.map(ChewyPricePerUnit.mapPlpProduct);
          return true;
        }
      } catch (e) {
        LOG("ensurePlpProducts: fetch failed", e);
      }
      return false;
    }
    async sortListingByUnitPrice(order) {
      LOG("sortListingByUnitPrice", order, "start");
      const gridContainer = document.querySelector(ChewyPricePerUnit.GRID_CONTAINER_SELECTOR);
      if (!gridContainer) {
        LOG("sortListingByUnitPrice: grid container not found, abort");
        return;
      }
      const cards = Array.from(
        gridContainer.querySelectorAll(ChewyPricePerUnit.PRODUCT_CARD_SELECTOR)
      );
      LOG("sortListingByUnitPrice: cards.length", cards.length);
      if (cards.length === 0) return;
      const apiPpuById = new Map();
      await this.ensurePlpProducts();
      for (const p of this.plpProducts) {
        const ppu = this.parsePpu(p.ppu);
        apiPpuById.set(p.linkId, ppu ?? Number.POSITIVE_INFINITY);
      }
      const getPpu = (card) => {
        const id = this.getProductIdFromCard(card);
        if (id && apiPpuById.has(id)) return apiPpuById.get(id);
        const domPpu = card.getAttribute("data-price-per-unit");
        return this.parsePpu(domPpu) ?? Number.POSITIVE_INFINITY;
      };
      cards.sort((a, b) => {
        const ppuA = getPpu(a);
        const ppuB = getPpu(b);
        return order === "asc" ? ppuA - ppuB : ppuB - ppuA;
      });
      LOG("sortListingByUnitPrice: reordering", cards.length, "cards");
      for (const card of cards) {
        gridContainer.appendChild(card);
      }
      LOG("sortListingByUnitPrice: done");
    }
    async waitForStable(ms) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
  }
  class PetSmartPricePerUnit extends BaseSiteHandler {
    static PRICE_SELECTOR = ".sparky-c-price";
    static SIZE_SELECTOR = ".size-variant__fields .sparky-c-definition-list__description";
    async initialize() {
      if (this.isProductPage()) {
        await this.addPricePerUnit();
      }
    }
    isProductPage() {
      return !!document.querySelector(".product-details__layout-right");
    }
    extractProductInfo(element) {
      const priceElement = element.querySelector(
        PetSmartPricePerUnit.PRICE_SELECTOR
      );
      const sizeElement = element.querySelector(
        PetSmartPricePerUnit.SIZE_SELECTOR
      );
      if (!priceElement || !sizeElement) return null;
      const salePrice = priceElement.querySelector(".sparky-c-price--sale");
      const priceText = (salePrice?.textContent || priceElement.textContent)?.trim() || "";
      const sizeText = sizeElement.textContent?.trim() || "";
      const price = parseFloat(priceText.replace("$", ""));
      if (isNaN(price)) return null;
      const sizeInfo = parseSize(sizeText);
      if (!sizeInfo) return null;
      const pricePerUnit = price / sizeInfo.quantity;
      return {
        price,
        quantity: sizeInfo.quantity,
        unit: sizeInfo.unit,
        pricePerUnit
      };
    }
    async addPricePerUnit() {
      await new Promise((resolve) => setTimeout(resolve, 1e3));
      const productContainer = document.querySelector(
        ".product-details__layout-right"
      );
      if (!productContainer) return;
      const priceContainer = productContainer.querySelector(".product-price");
      if (!priceContainer) return;
      this.createObserver(
        productContainer,
        priceContainer,
        (element2) => priceContainer.appendChild(element2)
      );
      const productInfo = this.extractProductInfo(productContainer);
      if (!productInfo?.pricePerUnit) return;
      const element = createPricePerUnitElement(
        formatPricePerUnit(productInfo.pricePerUnit, productInfo.unit)
      );
      priceContainer.appendChild(element);
    }
  }
  const SITE_HANDLERS = [
    {
      matcher: (url) => url.includes("petsmart.com"),
      handler: PetSmartPricePerUnit
    },
    {
      matcher: (url) => url.includes("chewy.com"),
      handler: ChewyPricePerUnit
    }
  ];
  const currentHandler = SITE_HANDLERS.find(
    ({ matcher }) => matcher(window.location.href)
  );
  if (currentHandler) {
    new currentHandler.handler().initialize().catch(console.error);
  }

})();