import { BaseSiteHandler } from './BaseSiteHandler';
import { ProductInfo } from './types';
import {
  createPricePerUnitElement,
  formatPricePerUnit,
  parseSize,
} from './utils';

export class PetSmartPricePerUnit extends BaseSiteHandler {
  private static readonly PRODUCT_CONTAINER = '.pdp__details';
  private static readonly PRICE_SELECTOR = '.sparky-c-price';

  public async initialize() {
    if (this.isProductPage()) {
      await this.addPricePerUnit();
    } else {
      await this.addPricePerUnitOnListingPage();
    }
  }

  protected isProductPage(): boolean {
    return !!document.querySelector(PetSmartPricePerUnit.PRODUCT_CONTAINER);
  }

  private getSizeText(container: Element): string {
    const keys = container.querySelectorAll('.variants-fieldset__legend-key');
    for (const key of keys) {
      if (key.textContent?.toLowerCase().includes('size')) {
        const value = key.parentElement?.querySelector('.variants-fieldset__legend-value');
        if (value?.textContent) return value.textContent.trim();
      }
    }
    return container.querySelector('h1')?.textContent?.trim() ?? '';
  }

  protected extractProductInfo(element: Element): ProductInfo | null {
    const priceEl = element.querySelector(PetSmartPricePerUnit.PRICE_SELECTOR);
    if (!priceEl) return null;

    const salePrice = priceEl.querySelector('.sparky-c-price--sale');
    const priceText =
      (salePrice?.textContent || priceEl.textContent)?.trim() || '';

    const priceMatch = priceText.match(/\$[\d,]+(?:\.\d{2})?/);
    const price = priceMatch
      ? parseFloat(priceMatch[0].replace(/[$,]/g, ''))
      : NaN;
    if (!Number.isFinite(price)) return null;

    const sizeText = this.getSizeText(element);
    const sizeInfo = parseSize(sizeText);
    if (!sizeInfo) return null;

    const pricePerUnit = price / sizeInfo.quantity;
    return {
      price,
      quantity: sizeInfo.quantity,
      unit: sizeInfo.unit,
      pricePerUnit,
    };
  }

  private async addPricePerUnit() {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const productContainer = document.querySelector(
      PetSmartPricePerUnit.PRODUCT_CONTAINER,
    );
    if (!productContainer) return;

    const priceContainer =
      productContainer.querySelector('.product-price') ??
      productContainer.querySelector('.product-price-sparky');
    if (!priceContainer) return;

    this.createObserver(productContainer, priceContainer, (element) =>
      priceContainer.appendChild(element),
    );

    const productInfo = this.extractProductInfo(productContainer);
    if (!productInfo?.pricePerUnit) return;

    const element = createPricePerUnitElement(
      formatPricePerUnit(productInfo.pricePerUnit, productInfo.unit),
    );
    priceContainer.appendChild(element);
  }

  private async addPricePerUnitOnListingPage() {
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const cards = document.querySelectorAll('[data-testid="product-card"]');
    for (const card of cards) {
      this.addPpuToCard(card);
    }

    const container = cards[0]?.parentElement;
    if (container) {
      new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            const newCards = node.matches('[data-testid="product-card"]')
              ? [node]
              : Array.from(node.querySelectorAll('[data-testid="product-card"]'));
            for (const card of newCards) this.addPpuToCard(card);
          }
        }
      }).observe(container, { childList: true, subtree: true });
    }
  }

  /** Find the last (most relevant) size match in a product title — prefers count over per-item size for multi-packs. */
  private parseSizeFromTitle(title: string): { quantity: number; unit: string } | null {
    const regex = /([\d.]+)[\s-]*(lb\.?s?|oz\.?|count|ct\.?|pack|pk\.?|each|ea\.?|g|kg|ml|L)\b/gi;
    let last: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(title)) !== null) {
      last = match;
    }
    if (!last?.[1] || !last?.[2]) return null;
    return {
      quantity: parseFloat(last[1]),
      unit: last[2].toLowerCase().replace(/\.$/, '').trim(),
    };
  }

  private addPpuToCard(card: Element) {
    if (card.querySelector('.price-per-unit')) return;

    const title = card.querySelector('.sparky-c-product-card__title')?.textContent?.trim() ?? '';
    const sizeInfo = this.parseSizeFromTitle(title);
    if (!sizeInfo) return;

    const priceGroup = card.querySelector('.sparky-c-product-card__price-group');
    if (!priceGroup) return;

    const priceText = priceGroup.textContent?.trim() ?? '';
    if (priceText.includes('-')) return;

    const priceMatch = priceText.match(/\$[\d,]+(?:\.\d{2})?/);
    const price = priceMatch ? parseFloat(priceMatch[0].replace(/[$,]/g, '')) : NaN;
    if (!Number.isFinite(price)) return;

    const pricePerUnit = price / sizeInfo.quantity;
    priceGroup.appendChild(
      createPricePerUnitElement(formatPricePerUnit(pricePerUnit, sizeInfo.unit)),
    );
  }
}
