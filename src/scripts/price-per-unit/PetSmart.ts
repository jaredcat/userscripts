interface ProductInfo {
  price: number;
  quantity: number;
  unit: string;
  pricePerUnit?: number;
}

export class PetSmartPricePerUnit {
  private static readonly PRICE_SELECTOR = '.sparky-c-price';
  private static readonly SIZE_SELECTOR =
    '.size-variant__fields .sparky-c-definition-list__description';

  public async initialize() {
    if (this.isProductPage()) {
      await this.addPricePerUnit();
    }
  }

  private isProductPage(): boolean {
    // Product pages have the product-details__layout-right class
    return !!document.querySelector('.product-details__layout-right');
  }

  private parseSize(
    sizeText: string,
  ): { quantity: number; unit: string } | null {
    // Handle formats like "40 Lb", "20 oz", etc.
    const match = sizeText.match(/^([\d.]+)\s*(.+)$/);
    if (!match) return null;

    const quantity = parseFloat(match[1]);
    const unit = match[2].toLowerCase().trim();

    return { quantity, unit };
  }

  private formatPricePerUnit(price: number, unit: string): string {
    return `$${price.toFixed(3)}/${unit}`;
  }

  private extractProductInfo(element: Element): ProductInfo | null {
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
    const sizeInfo = this.parseSize(sizeText);
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

    // Setup observer before making changes
    const observer = new MutationObserver(() => {
      // Always try to update when price container changes
      const productInfo = this.extractProductInfo(productContainer);
      if (!productInfo) return;

      let pricePerUnitElement: HTMLElement | null =
        priceContainer.querySelector('.price-per-unit');

      if (!pricePerUnitElement) {
        // Create new element if it doesn't exist
        pricePerUnitElement = document.createElement('div');
        pricePerUnitElement.className = 'price-per-unit';
        pricePerUnitElement.style.cssText = `
          margin: 0 8px;
          color: red;
          font-size: 1em;
          font-family: monospace;
          font-weight: bold;
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
        `;
        priceContainer.appendChild(pricePerUnitElement);
      }

      // Update the text content
      pricePerUnitElement.textContent = this.formatPricePerUnit(
        productInfo.pricePerUnit!,
        productInfo.unit,
      );
      console.debug('Price per unit updated:', pricePerUnitElement.textContent);
    });

    observer.observe(priceContainer, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Initial insertion
    this.insertPricePerUnit(productContainer, priceContainer);
  }

  private insertPricePerUnit(productContainer: Element, target: Element) {
    const productInfo = this.extractProductInfo(productContainer);
    if (!productInfo) return;

    // Check if we already added the element
    if (target.querySelector('.price-per-unit')) return;

    const pricePerUnitElement = document.createElement('div');
    pricePerUnitElement.className = 'price-per-unit';
    pricePerUnitElement.style.cssText = `
      margin: 0 8px;
      color: red;
      font-size: 1em;
      font-family: monospace;
      font-weight: bold;
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
    `;
    pricePerUnitElement.textContent = this.formatPricePerUnit(
      productInfo.pricePerUnit!,
      productInfo.unit,
    );

    target.appendChild(pricePerUnitElement);
    console.debug('Price per unit added:', pricePerUnitElement.textContent);
  }
}
