// ==UserScript==
// @name         Price Per Unit
// @namespace    jaredcat/price-per-unit
// @version      1.0.1
// @author       jaredcat
// @description  Adds price per unit to product pages and enables sorting by unit price
// @license      AGPL-3.0-or-later
// @downloadURL  https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/price-per-unit.user.js
// @updateURL    https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/price-per-unit.user.js
// @match        *://*.petsmart.com/*
// ==/UserScript==

(function () {
  'use strict';

  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  function parseSize(sizeText) {
    const match = sizeText.match(/^([\d.]+)\s*(.+)$/);
    if (!match) return null;
    const quantity = parseFloat(match[1]);
    const unit = match[2].toLowerCase().trim();
    return { quantity, unit };
  }
  function formatPricePerUnit(price, unit) {
    return `$${price.toFixed(3)}/${unit}`;
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
  const _PetSmartPricePerUnit = class _PetSmartPricePerUnit extends BaseSiteHandler {
    async initialize() {
      if (this.isProductPage()) {
        await this.addPricePerUnit();
      }
    }
    isProductPage() {
      return !!document.querySelector(".product-details__layout-right");
    }
    extractProductInfo(element) {
      var _a, _b;
      const priceElement = element.querySelector(
        _PetSmartPricePerUnit.PRICE_SELECTOR
      );
      const sizeElement = element.querySelector(
        _PetSmartPricePerUnit.SIZE_SELECTOR
      );
      if (!priceElement || !sizeElement) return null;
      const salePrice = priceElement.querySelector(".sparky-c-price--sale");
      const priceText = ((_a = (salePrice == null ? undefined : salePrice.textContent) || priceElement.textContent) == null ? undefined : _a.trim()) || "";
      const sizeText = ((_b = sizeElement.textContent) == null ? undefined : _b.trim()) || "";
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
      if (!productInfo) return;
      const element = createPricePerUnitElement(
        formatPricePerUnit(productInfo.pricePerUnit, productInfo.unit)
      );
      priceContainer.appendChild(element);
    }
  };
  __publicField(_PetSmartPricePerUnit, "PRICE_SELECTOR", ".sparky-c-price");
  __publicField(_PetSmartPricePerUnit, "SIZE_SELECTOR", ".size-variant__fields .sparky-c-definition-list__description");
  let PetSmartPricePerUnit = _PetSmartPricePerUnit;
  const SITE_HANDLERS = [
    {
      matcher: (url) => url.includes("petsmart.com"),
      handler: PetSmartPricePerUnit
    }
    // Add future sites here like:
    // {
    //   matcher: (url: string) => url.includes('somestore.com'),
    //   handler: SomeStorePricePerUnit,
    // },
  ];
  const currentHandler = SITE_HANDLERS.find(
    ({ matcher }) => matcher(window.location.href)
  );
  if (currentHandler) {
    new currentHandler.handler().initialize();
  }

})();