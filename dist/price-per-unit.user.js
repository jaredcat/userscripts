// ==UserScript==
// @name         Price Per Unit
// @namespace    jaredcat/price-per-unit
// @version      1.1.2
// @author       jaredcat
// @description  Adds price per unit to product pages and enables sorting by unit price
// @license      AGPL-3.0-or-later
// @downloadURL  https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/price-per-unit.user.js
// @updateURL    https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/price-per-unit.user.js
// @match        *://*.petsmart.com/*
// @match        *://*.chewy.com/*
// @grant        unsafeWindow
// ==/UserScript==

(async function() {
	"use strict";
	var UNIT_ALIASES = {
		lb: "lb",
		lbs: "lb",
		oz: "oz",
		count: "count",
		ct: "count",
		pack: "pack",
		pk: "pack",
		each: "each",
		ea: "each",
		g: "g",
		kg: "kg",
		ml: "ml",
		l: "l"
	};
	var VERY_SMALL_PRICE = .01;
	var FRACTIONAL_PRICE = 1;
	var DECIMALS_VERY_SMALL = 4;
	var DECIMALS_FRACTIONAL = 3;
	var DECIMALS_DEFAULT = 2;
	var PRICE_PATTERN = /\$[\d,]+(?:\.\d{2})?/;
	var NUMBER_PATTERN = /\d+(?:\.\d+)?/g;
	var UNIT_AFTER_NUMBER_PATTERN = /^[\s-]*([a-z]+)/i;
	function stripPriceFormatting(text) {
		let output = "";
		for (const character of text) {
			if (character === "$" || character === ",") continue;
			output += character;
		}
		return output;
	}
	function parseSizeMatch(text, shouldPreferLast) {
		const numberPattern = new RegExp(NUMBER_PATTERN.source, NUMBER_PATTERN.flags);
		let result;
		let numberMatch = numberPattern.exec(text);
		while (numberMatch) {
			const quantityText = numberMatch[0];
			const afterIndex = numberMatch.index + quantityText.length;
			numberMatch = numberPattern.exec(text);
			const rawUnit = UNIT_AFTER_NUMBER_PATTERN.exec(text.slice(afterIndex))?.[1]?.toLowerCase();
			if (!rawUnit) continue;
			const unit = UNIT_ALIASES[rawUnit];
			if (!unit) continue;
			const quantity = Number(quantityText);
			if (!Number.isFinite(quantity)) continue;
			result = {
				quantity,
				unit
			};
			if (!shouldPreferLast) break;
		}
		return result;
	}
	function parseSize(sizeText) {
		return parseSizeMatch(sizeText, false);
	}
	function parseLastSize(sizeText) {
		return parseSizeMatch(sizeText, true);
	}
	function parsePrice(priceText) {
		const priceMatch = PRICE_PATTERN.exec(priceText);
		if (!priceMatch?.[0]) return NaN;
		return Number(stripPriceFormatting(priceMatch[0]));
	}
	function formatPricePerUnit(price, unit) {
		let decimals = DECIMALS_DEFAULT;
		if (price < VERY_SMALL_PRICE) decimals = DECIMALS_VERY_SMALL;
		else if (price < FRACTIONAL_PRICE) decimals = DECIMALS_FRACTIONAL;
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
	var BaseSiteHandler = class {
		createObserver(container, priceContainer, onUpdate) {
			const observeOptions = {
				childList: true,
				subtree: true,
				characterData: true
			};
			const observer = new MutationObserver(() => {
				const productInfo = this.extractProductInfo(container);
				if (!productInfo) return;
				if (productInfo.pricePerUnit === void 0) return;
				const newText = formatPricePerUnit(productInfo.pricePerUnit, productInfo.unit);
				let pricePerUnitElement = priceContainer.querySelector(".price-per-unit");
				observer.disconnect();
				if (!pricePerUnitElement) {
					pricePerUnitElement = createPricePerUnitElement(newText);
					onUpdate(pricePerUnitElement);
				} else if (pricePerUnitElement.textContent !== newText) pricePerUnitElement.textContent = newText;
				observer.observe(priceContainer, observeOptions);
			});
			observer.observe(priceContainer, observeOptions);
			return observer;
		}
	};
	var IS_DEBUG = (() => {
		try {
			return localStorage.getItem("ppu-debug") === "1";
		} catch {
			return false;
		}
	})();
	var LOG = (message, ...arguments_) => {
		if (IS_DEBUG) console.log("[price-per-unit Chewy]", message, ...arguments_);
	};
	var PRODUCT_PAGE_WAIT_MS$1 = 800;
	var LISTING_PAGE_WAIT_MS$1 = 1200;
	var WAIT_FOR_MAIN_MAX_MS = 1e4;
	var WAIT_FOR_MAIN_INTERVAL_MS = 200;
	var DP_PATH_PATTERN = /\/dp\/([^/?#]+)/;
	var GROUP_ID_PATTERN = /-(\d+)$/;
	function isChewyPlpSearchResponse(value) {
		if (typeof value !== "object" || !value) return false;
		if (!("products" in value)) return true;
		return Array.isArray(value.products);
	}
	function asOptionalString(value) {
		if (typeof value === "string") return value;
		if (typeof value === "number" || typeof value === "boolean") return String(value);
	}
	function asString(value, fallback = "") {
		return asOptionalString(value) ?? fallback;
	}
	var ChewyPricePerUnit = class ChewyPricePerUnit extends BaseSiteHandler {
		static LISTING_PAGE_INDICATOR = [
			"[data-testid=\"product-listing\"]",
			".productlisting_container",
			"[class*=\"ProductListing\"]",
			"main [class*=\"browse\"]"
		].join(", ");
		static CARD_LINK_SELECTOR = "a[href*=\"/dp/\"]";
		static GRID_CONTAINER_SELECTOR = "[class*=\"ProductListingGrid_gridContainer\"]";
		static PRODUCT_CARD_SELECTOR = ".kib-product-card[data-category]:not(.js-tracked-ad-product)";
		static DESKTOP_SORT_SELECTOR = "[class*=\"ProductListingGrid_resultsSort\"]";
		static PRICE_IN_CARD = [
			"[data-testid*=\"price\"]",
			".price",
			"[class*=\"Price\"]",
			"span[class*=\"price\"]"
		].join(", ");
		static SIZE_IN_CARD = [
			"[data-testid*=\"size\"]",
			".size",
			"[class*=\"Size\"]",
			"[class*=\"weight\"]",
			".product-size",
			"span[class*=\"size\"]"
		].join(", ");
		static mapPlpProduct(product) {
			const href = asOptionalString(product.href);
			const dpMatch = href ? DP_PATH_PATTERN.exec(href) : void 0;
			return {
				catalogEntryId: Number(product.catalogEntryId),
				parentCatalogEntryId: asString(product.parentCatalogEntryId),
				partNumber: asString(product.partNumber),
				ppu: asOptionalString(product.ppu),
				href,
				linkId: dpMatch?.[1] ?? asString(product.parentCatalogEntryId ?? product.catalogEntryId)
			};
		}
		plpProducts = [];
		get targetWindow() {
			return unsafeWindow ?? globalThis;
		}
		isListingPage() {
			return /\/b\/[^/]+/i.test(location.pathname) || !!document.querySelector(ChewyPricePerUnit.LISTING_PAGE_INDICATOR);
		}
		async addPricePerUnitOnProductPage() {
			await this.waitForStable(PRODUCT_PAGE_WAIT_MS$1);
			const container = document.querySelector("[data-testid=\"product-detail\"]") ?? document.querySelector(".product-detail") ?? document.querySelector("[class*=\"ProductDetail\"]") ?? document.querySelector("main");
			if (!container) return;
			const priceContainer = container.querySelector(ChewyPricePerUnit.PRICE_IN_CARD) ?? container.querySelector(".price");
			if (!priceContainer) return;
			this.createObserver(container, priceContainer, (element) => priceContainer.append(element));
			const productInfo = this.extractProductInfo(container);
			if (!productInfo?.pricePerUnit) return;
			const element = createPricePerUnitElement(formatPricePerUnit(productInfo.pricePerUnit, productInfo.unit));
			priceContainer.append(element);
		}
		findDesktopSortContainer() {
			const sortSelect = document.querySelector("[class*=\"Sort_sortSelect\"]");
			if (sortSelect?.parentElement) return sortSelect.parentElement;
			return document.querySelector(ChewyPricePerUnit.DESKTOP_SORT_SELECTOR) ?? void 0;
		}
		createSortButtonsFragment() {
			const wrap = document.createElement("span");
			wrap.style.display = "inline-flex";
			wrap.dataset.pricePerUnitSort = "1";
			const buttonAsc = document.createElement("button");
			buttonAsc.type = "button";
			buttonAsc.textContent = "Unit price ↑";
			buttonAsc.style.cssText = "margin-left:8px;cursor:pointer;padding:4px 8px;";
			buttonAsc.addEventListener("click", () => this.sortListingByUnitPrice("asc"));
			const buttonDesc = document.createElement("button");
			buttonDesc.type = "button";
			buttonDesc.textContent = "Unit price ↓";
			buttonDesc.style.cssText = "margin-left:4px;cursor:pointer;padding:4px 8px;";
			buttonDesc.addEventListener("click", () => this.sortListingByUnitPrice("desc"));
			wrap.append(buttonAsc, buttonDesc);
			return wrap;
		}
		async waitForMainThenAddSort() {
			const deadline = Date.now() + WAIT_FOR_MAIN_MAX_MS;
			const readySelector = `${ChewyPricePerUnit.GRID_CONTAINER_SELECTOR}, ${ChewyPricePerUnit.DESKTOP_SORT_SELECTOR}`;
			while (!document.querySelector(readySelector) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, WAIT_FOR_MAIN_INTERVAL_MS));
			if (!document.querySelector(readySelector)) LOG("waitForMainThenAddSort: grid never appeared");
			await this.addSortByUnitPriceOnListingPage();
		}
		async addSortByUnitPriceOnListingPage() {
			await this.waitForStable(LISTING_PAGE_WAIT_MS$1);
			const desktopContainer = this.findDesktopSortContainer();
			const mobileContainer = document.querySelector("[class*=\"MobileSortAndFacetControls_sortFilter\"]");
			LOG("addSortByUnitPrice: desktopContainer=", !!desktopContainer, "mobileContainer=", !!mobileContainer);
			if (desktopContainer && !desktopContainer.querySelector("[data-price-per-unit-sort=\"1\"]")) {
				desktopContainer.append(this.createSortButtonsFragment());
				LOG("addSortByUnitPrice: injected into desktop container");
			}
			if (mobileContainer && !mobileContainer.querySelector("[data-price-per-unit-sort=\"1\"]")) {
				mobileContainer.append(this.createSortButtonsFragment());
				LOG("addSortByUnitPrice: injected into mobile container");
			}
			if (!desktopContainer && !mobileContainer) {
				const grid = document.querySelector(ChewyPricePerUnit.GRID_CONTAINER_SELECTOR);
				if (grid) grid.insertAdjacentElement("beforebegin", this.createSortButtonsFragment());
				else document.body.append(this.createSortButtonsFragment());
				LOG("addSortByUnitPrice: fallback inject");
			}
		}
		resolveFetchUrl(input) {
			if (typeof input === "string") return input;
			if (input instanceof Request) return input.url;
			return input.href;
		}
		productsFromPlpJson(json) {
			if (!isChewyPlpSearchResponse(json) || !Array.isArray(json.products)) return;
			return json.products.map((product) => ChewyPricePerUnit.mapPlpProduct(product));
		}
		interceptPlpFetch() {
			const win = this.targetWindow;
			const originalFetch = win.fetch.bind(win);
			win.fetch = async (input, init) => {
				const url = this.resolveFetchUrl(input);
				const response = await originalFetch(input, init);
				if (url.includes("/plp/api/search")) try {
					const json = await response.clone().json();
					const products = this.productsFromPlpJson(json);
					if (products) this.plpProducts = products;
				} catch (error) {
					LOG("interceptPlpFetch: failed to parse response", error);
				}
				return response;
			};
		}
		parsePpu(ppu) {
			if (ppu === void 0) return void 0;
			const number_ = /\$?([\d.]+)/.exec(ppu)?.[1];
			return number_ === void 0 ? void 0 : Number(number_);
		}
		getProductIdFromCard(card) {
			if (card instanceof HTMLElement) {
				const category = card.dataset.category;
				if (category) return category;
			}
			const anchor = card.querySelector(ChewyPricePerUnit.CARD_LINK_SELECTOR);
			if (!anchor?.href) return void 0;
			return DP_PATH_PATTERN.exec(anchor.href)?.[1];
		}
		async ensurePlpProducts() {
			if (this.plpProducts.length > 0) return true;
			const groupId = GROUP_ID_PATTERN.exec(location.pathname)?.[1];
			if (!groupId) return false;
			const url = `https://www.chewy.com/plp/api/search?catalogId=1004&count=36&from=0&sort=byRelevance&groupId=${groupId}`;
			try {
				const json = await (await this.targetWindow.fetch(url, { credentials: "include" })).json();
				const products = this.productsFromPlpJson(json);
				if (products) {
					this.plpProducts = products;
					return true;
				}
			} catch (error) {
				LOG("ensurePlpProducts: fetch failed", error);
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
			const cards = [...gridContainer.querySelectorAll(ChewyPricePerUnit.PRODUCT_CARD_SELECTOR)];
			LOG("sortListingByUnitPrice: cards.length", cards.length);
			if (cards.length === 0) return;
			const apiPpuById = new Map();
			await this.ensurePlpProducts();
			for (const product of this.plpProducts) {
				const ppu = this.parsePpu(product.ppu);
				apiPpuById.set(product.linkId, ppu ?? Number.POSITIVE_INFINITY);
			}
			const getPpu = (card) => {
				const id = this.getProductIdFromCard(card);
				if (id) {
					const fromApi = apiPpuById.get(id);
					if (fromApi !== void 0) return fromApi;
				}
				return this.parsePpu(card.dataset.pricePerUnit) ?? Number.POSITIVE_INFINITY;
			};
			cards.sort((a, b) => {
				const ppuA = getPpu(a);
				const ppuB = getPpu(b);
				return order === "asc" ? ppuA - ppuB : ppuB - ppuA;
			});
			LOG("sortListingByUnitPrice: reordering", cards.length, "cards");
			for (const card of cards) gridContainer.append(card);
			LOG("sortListingByUnitPrice: done");
		}
		async waitForStable(ms) {
			await new Promise((resolve) => setTimeout(resolve, ms));
		}
		async initialize() {
			this.interceptPlpFetch();
			if (this.isProductPage()) await this.addPricePerUnitOnProductPage();
			else if (this.isListingPage()) await this.waitForMainThenAddSort();
		}
		isProductPage() {
			return /\/p\/[^/]+/i.test(location.pathname) || !!document.querySelector("[data-testid=\"product-detail\"], .product-detail, [class*=\"ProductDetail\"]");
		}
		extractProductInfo(element) {
			const priceElement = element.querySelector(ChewyPricePerUnit.PRICE_IN_CARD);
			const sizeElement = element.querySelector(ChewyPricePerUnit.SIZE_IN_CARD);
			const priceText = (priceElement?.textContent ?? "").trim();
			const sizeText = (sizeElement?.textContent ?? "").trim();
			const price = parsePrice(priceText);
			if (!Number.isFinite(price)) return void 0;
			const sizeInfo = parseSize(sizeText);
			if (!sizeInfo) {
				const fromAny = parseSize((element.getAttribute("aria-label") ?? element.querySelector("[class*=\"title\"], [class*=\"name\"]")?.textContent ?? "") || sizeText || priceText);
				if (!fromAny) return void 0;
				const pricePerUnit = price / fromAny.quantity;
				return {
					price,
					quantity: fromAny.quantity,
					unit: fromAny.unit,
					pricePerUnit
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
	};
	var PRODUCT_PAGE_WAIT_MS = 1e3;
	var LISTING_PAGE_WAIT_MS = 1500;
	var currentHandler = [{
		matcher: (url) => url.includes("petsmart.com"),
		handler: class PetSmartPricePerUnit extends BaseSiteHandler {
			static PRODUCT_CONTAINER = ".pdp__details";
			static PRICE_SELECTOR = ".sparky-c-price";
			getSizeText(container) {
				const keys = container.querySelectorAll(".variants-fieldset__legend-key");
				for (const key of keys) {
					if (!key.textContent?.toLowerCase().includes("size")) continue;
					const value = key.parentElement?.querySelector(".variants-fieldset__legend-value");
					if (value?.textContent) return value.textContent.trim();
				}
				return container.querySelector("h1")?.textContent?.trim() ?? "";
			}
			async addPricePerUnit() {
				await new Promise((resolve) => setTimeout(resolve, PRODUCT_PAGE_WAIT_MS));
				const productContainer = document.querySelector(PetSmartPricePerUnit.PRODUCT_CONTAINER);
				if (!productContainer) return;
				const priceContainer = productContainer.querySelector(".product-price") ?? productContainer.querySelector(".product-price-sparky");
				if (!priceContainer) return;
				this.createObserver(productContainer, priceContainer, (element) => priceContainer.append(element));
				const productInfo = this.extractProductInfo(productContainer);
				if (!productInfo?.pricePerUnit) return;
				const element = createPricePerUnitElement(formatPricePerUnit(productInfo.pricePerUnit, productInfo.unit));
				priceContainer.append(element);
			}
			addPpuToCard(card) {
				if (card.querySelector(".price-per-unit")) return;
				const sizeInfo = parseLastSize(card.querySelector(".sparky-c-product-card__title")?.textContent?.trim() ?? "");
				if (!sizeInfo) return;
				const priceGroup = card.querySelector(".sparky-c-product-card__price-group");
				if (!priceGroup) return;
				const priceText = priceGroup.textContent?.trim() ?? "";
				if (priceText.includes("-")) return;
				const price = parsePrice(priceText);
				if (!Number.isFinite(price)) return;
				const pricePerUnit = price / sizeInfo.quantity;
				priceGroup.append(createPricePerUnitElement(formatPricePerUnit(pricePerUnit, sizeInfo.unit)));
			}
			processAddedListingNode(node) {
				if (!(node instanceof HTMLElement)) return;
				const newCards = node.matches("[data-testid=\"product-card\"]") ? [node] : [...node.querySelectorAll("[data-testid=\"product-card\"]")];
				for (const card of newCards) this.addPpuToCard(card);
			}
			async addPricePerUnitOnListingPage() {
				await new Promise((resolve) => setTimeout(resolve, LISTING_PAGE_WAIT_MS));
				const cards = document.querySelectorAll("[data-testid=\"product-card\"]");
				for (const card of cards) this.addPpuToCard(card);
				const container = cards[0]?.parentElement;
				if (container) new MutationObserver((mutations) => {
					for (const mutation of mutations) for (const node of mutation.addedNodes) this.processAddedListingNode(node);
				}).observe(container, {
					childList: true,
					subtree: true
				});
			}
			async initialize() {
				if (this.isProductPage()) await this.addPricePerUnit();
				else await this.addPricePerUnitOnListingPage();
			}
			isProductPage() {
				return !!document.querySelector(PetSmartPricePerUnit.PRODUCT_CONTAINER);
			}
			extractProductInfo(element) {
				const priceElement = element.querySelector(PetSmartPricePerUnit.PRICE_SELECTOR);
				if (!priceElement) return void 0;
				const price = parsePrice((priceElement.querySelector(".sparky-c-price--sale")?.textContent || priceElement.textContent)?.trim() || "");
				if (!Number.isFinite(price)) return void 0;
				const sizeInfo = parseSize(this.getSizeText(element));
				if (!sizeInfo) return void 0;
				const pricePerUnit = price / sizeInfo.quantity;
				return {
					price,
					quantity: sizeInfo.quantity,
					unit: sizeInfo.unit,
					pricePerUnit
				};
			}
		}
	}, {
		matcher: (url) => url.includes("chewy.com"),
		handler: ChewyPricePerUnit
	}].find(({ matcher }) => matcher(location.href));
	if (currentHandler) try {
		await(new currentHandler.handler().initialize());
	} catch (error) {
		console.error(error);
	}
})();
