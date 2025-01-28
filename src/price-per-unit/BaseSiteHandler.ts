import { ProductInfo } from './types';
import { createPricePerUnitElement, formatPricePerUnit } from './utils';

export abstract class BaseSiteHandler {
  public abstract initialize(): Promise<void>;

  protected abstract isProductPage(): boolean;
  protected abstract extractProductInfo(element: Element): ProductInfo | null;

  protected createObserver(
    container: Element,
    priceContainer: Element,
    onUpdate: (element: HTMLElement) => void,
  ): MutationObserver {
    const observer = new MutationObserver(() => {
      const productInfo = this.extractProductInfo(container);
      if (!productInfo) return;

      let pricePerUnitElement: HTMLElement | null =
        priceContainer.querySelector('.price-per-unit');

      if (!pricePerUnitElement) {
        pricePerUnitElement = createPricePerUnitElement(
          formatPricePerUnit(productInfo.pricePerUnit!, productInfo.unit),
        );
        onUpdate(pricePerUnitElement);
      } else {
        pricePerUnitElement.textContent = formatPricePerUnit(
          productInfo.pricePerUnit!,
          productInfo.unit,
        );
      }

      console.debug('Price per unit updated:', pricePerUnitElement.textContent);
    });

    observer.observe(priceContainer, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return observer;
  }
}
