import { SizeInfo } from './types';

export function parseSize(sizeText: string): SizeInfo | null {
  // Handle formats like "40 Lb", "20 oz", etc.
  const match = sizeText.match(/^([\d.]+)\s*(.+)$/);
  if (!match?.[1] || !match?.[2]) return null;

  const quantity = parseFloat(match[1]);
  const unit = match[2].toLowerCase().trim();

  return { quantity, unit };
}

export function formatPricePerUnit(price: number, unit: string): string {
  return `$${price.toFixed(3)}/${unit}`;
}

export function createPricePerUnitElement(text: string): HTMLElement {
  const element = document.createElement('div');
  element.className = 'price-per-unit';
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
