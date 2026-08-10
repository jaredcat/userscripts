import { BaseSiteHandler } from './BaseSiteHandler';
import { ProductInfo } from './types';
import {
  createPricePerUnitElement,
  formatPricePerUnit,
  parseLastSize,
  parsePrice,
  parseSize,
} from './utilities';

const PRODUCT_PAGE_WAIT_MS = 1000;
const LISTING_PAGE_WAIT_MS = 1500;

export class PetSmartPricePerUnit extends BaseSiteHandler {
  private static readonly PRODUCT_CONTAINER = '.pdp__details';
  private static readonly PRICE_SELECTOR = '.sparky-c-price';

  private getSizeText(container: Element): string {
    const keys = container.querySelectorAll('.variants-fieldset__legend-key');
    for (const key of keys) {
      if (!key.textContent?.toLowerCase().includes('size')) {
        continue;
      }

      const value = key.parentElement?.querySelector(
        '.variants-fieldset__legend-value',
      );
      if (value?.textContent) return value.textContent.trim();
    }
    return container.querySelector('h1')?.textContent?.trim() ?? '';
  }

  private async addPricePerUnit() {
    await new Promise((resolve) => setTimeout(resolve, PRODUCT_PAGE_WAIT_MS));

    const productContainer = document.querySelector(
      PetSmartPricePerUnit.PRODUCT_CONTAINER,
    );
    if (!productContainer) return;

    const priceContainer =
      productContainer.querySelector('.product-price') ??
      productContainer.querySelector('.product-price-sparky');
    if (!priceContainer) return;

    this.createObserver(productContainer, priceContainer, (element) =>
      priceContainer.append(element),
    );

    const productInfo = this.extractProductInfo(productContainer);
    if (!productInfo?.pricePerUnit) return;

    const element = createPricePerUnitElement(
      formatPricePerUnit(productInfo.pricePerUnit, productInfo.unit),
    );
    priceContainer.append(element);
  }

  private addPpuToCard(card: Element) {
    if (card.querySelector('.price-per-unit')) return;

    const title =
      card
        .querySelector('.sparky-c-product-card__title')
        ?.textContent?.trim() ?? '';
    const sizeInfo = parseLastSize(title);
    if (!sizeInfo) return;

    const priceGroup = card.querySelector(
      '.sparky-c-product-card__price-group',
    );
    if (!priceGroup) return;

    const priceText = priceGroup.textContent?.trim() ?? '';
    if (priceText.includes('-')) return;

    const price = parsePrice(priceText);
    if (!Number.isFinite(price)) return;

    const pricePerUnit = price / sizeInfo.quantity;
    priceGroup.append(
      createPricePerUnitElement(
        formatPricePerUnit(pricePerUnit, sizeInfo.unit),
      ),
    );
  }

  private processAddedListingNode(node: Node) {
    if (!(node instanceof HTMLElement)) return;
    const newCards = node.matches('[data-testid="product-card"]')
      ? [node]
      : [...node.querySelectorAll('[data-testid="product-card"]')];
    for (const card of newCards) this.addPpuToCard(card);
  }

  private async addPricePerUnitOnListingPage() {
    await new Promise((resolve) => setTimeout(resolve, LISTING_PAGE_WAIT_MS));

    const cards = document.querySelectorAll('[data-testid="product-card"]');
    for (const card of cards) {
      this.addPpuToCard(card);
    }

    const container = cards[0]?.parentElement;
    if (container) {
      new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            this.processAddedListingNode(node);
          }
        }
      }).observe(container, { childList: true, subtree: true });
    }
  }

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

  protected extractProductInfo(element: Element): ProductInfo | undefined {
    const priceElement = element.querySelector(
      PetSmartPricePerUnit.PRICE_SELECTOR,
    );
    if (!priceElement) return undefined;

    const salePrice = priceElement.querySelector('.sparky-c-price--sale');
    const priceText =
      (salePrice?.textContent || priceElement.textContent)?.trim() || '';

    const price = parsePrice(priceText);
    if (!Number.isFinite(price)) return undefined;

    const sizeText = this.getSizeText(element);
    const sizeInfo = parseSize(sizeText);
    if (!sizeInfo) return undefined;

    const pricePerUnit = price / sizeInfo.quantity;
    return {
      price,
      quantity: sizeInfo.quantity,
      unit: sizeInfo.unit,
      pricePerUnit,
    };
  }
}
