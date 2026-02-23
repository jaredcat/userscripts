import { SizeInfo } from './types';

export function parseSize(sizeText: string): SizeInfo | null {
  const match = sizeText.match(/([\d.]+)[\s-]*(lb\.?s?|oz\.?|count|ct\.?|pack|pk\.?|each|ea\.?|g|kg|ml|L)\b/i);
  if (!match?.[1] || !match?.[2]) return null;

  const quantity = parseFloat(match[1]);
  const unit = match[2].toLowerCase().replace(/\.$/, '').trim();

  return { quantity, unit };
}

export function formatPricePerUnit(price: number, unit: string): string {
  const decimals = price < 0.01 ? 4 : price < 1 ? 3 : 2;
  return `$${price.toFixed(decimals)}/${unit}`;
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
