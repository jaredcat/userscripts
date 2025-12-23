import { BaseSiteHandler } from './BaseSiteHandler';
import { ProductInfo } from './types';
import {
  createPricePerUnitElement,
  formatPricePerUnit,
  parseSize,
} from './utils';

export class PetSmartPricePerUnit extends BaseSiteHandler {
  private static readonly PRICE_SELECTOR = '.sparky-c-price';
  private static readonly SIZE_SELECTOR =
    '.size-variant__fields .sparky-c-definition-list__description';

  public async initialize() {
    if (this.isProductPage()) {
      await this.addPricePerUnit();
    }
  }

  protected isProductPage(): boolean {
    // Product pages have the product-details__layout-right class
    return !!document.querySelector('.product-details__layout-right');
  }

  protected extractProductInfo(element: Element): ProductInfo | null {
    const priceElement = element.querySelector(
      PetSmartPricePerUnit.PRICE_SELECTOR,
    );
    const sizeElement = element.querySelector(
      PetSmartPricePerUnit.SIZE_SELECTOR,
    );

    if (!priceElement || !sizeElement) return null;

    // First try to get sale price, then regular price
    const salePrice = priceElement.querySelector('.sparky-c-price--sale');
    const priceText =
      (salePrice?.textContent || priceElement.textContent)?.trim() || '';

    const sizeText = sizeElement.textContent?.trim() || '';

    // Extract price (remove $ and convert to number)
    const price = parseFloat(priceText.replace('$', ''));
    if (isNaN(price)) return null;

    // Parse size
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
    // Wait for page to stabilize
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const productContainer = document.querySelector(
      '.product-details__layout-right',
    );
    if (!productContainer) return;

    const priceContainer = productContainer.querySelector('.product-price');
    if (!priceContainer) return;

    this.createObserver(productContainer, priceContainer, (element) =>
      priceContainer.appendChild(element),
    );

    // Initial insertion
    const productInfo = this.extractProductInfo(productContainer);
    if (!productInfo?.pricePerUnit) return;

    const element = createPricePerUnitElement(
      formatPricePerUnit(productInfo.pricePerUnit, productInfo.unit),
    );
    priceContainer.appendChild(element);
  }
}
