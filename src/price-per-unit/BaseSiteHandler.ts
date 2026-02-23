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
    const observeOpts: MutationObserverInit = {
      childList: true,
      subtree: true,
      characterData: true,
    };

    const observer = new MutationObserver(() => {
      const productInfo = this.extractProductInfo(container);
      if (!productInfo) return;
      if (productInfo.pricePerUnit === undefined) return;

      const newText = formatPricePerUnit(productInfo.pricePerUnit, productInfo.unit);
      let pricePerUnitElement: HTMLElement | null =
        priceContainer.querySelector('.price-per-unit');

      observer.disconnect();
      if (!pricePerUnitElement) {
        pricePerUnitElement = createPricePerUnitElement(newText);
        onUpdate(pricePerUnitElement);
      } else if (pricePerUnitElement.textContent !== newText) {
        pricePerUnitElement.textContent = newText;
      }
      observer.observe(priceContainer, observeOpts);
    });

    observer.observe(priceContainer, observeOpts);
    return observer;
  }
}
