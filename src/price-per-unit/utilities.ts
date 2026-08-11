import { SizeInfo } from './types';

const UNIT_ALIASES: Record<string, string> = {
  lb: 'lb',
  lbs: 'lb',
  oz: 'oz',
  count: 'count',
  ct: 'count',
  pack: 'pack',
  pk: 'pack',
  each: 'each',
  ea: 'each',
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
};

const VERY_SMALL_PRICE = 0.01;
const FRACTIONAL_PRICE = 1;
const DECIMALS_VERY_SMALL = 4;
const DECIMALS_FRACTIONAL = 3;
const DECIMALS_DEFAULT = 2;

const PRICE_PATTERN = /\$[\d,]+(?:\.\d{2})?/;
const NUMBER_PATTERN = /\d+(?:\.\d+)?/g;
const UNIT_AFTER_NUMBER_PATTERN = /^[\s-]*([a-z]+)/i;

function stripPriceFormatting(text: string): string {
  let output = '';
  for (const character of text) {
    if (character === '$' || character === ',') continue;
    output += character;
  }
  return output;
}

function parseSizeMatch(
  text: string,
  shouldPreferLast: boolean,
): SizeInfo | undefined {
  const numberPattern = new RegExp(NUMBER_PATTERN.source, NUMBER_PATTERN.flags);
  let result: SizeInfo | undefined;
  let numberMatch = numberPattern.exec(text);
  while (numberMatch) {
    const quantityText = numberMatch[0];
    const afterIndex = numberMatch.index + quantityText.length;
    numberMatch = numberPattern.exec(text);

    const unitMatch = UNIT_AFTER_NUMBER_PATTERN.exec(text.slice(afterIndex));
    const rawUnit = unitMatch?.[1]?.toLowerCase();
    if (!rawUnit) continue;

    const unit = UNIT_ALIASES[rawUnit];
    if (!unit) continue;

    const quantity = Number(quantityText);
    if (!Number.isFinite(quantity)) continue;

    result = { quantity, unit };
    if (!shouldPreferLast) break;
  }
  return result;
}

export function parseSize(sizeText: string): SizeInfo | undefined {
  return parseSizeMatch(sizeText, false);
}

// Last size token in text (e.g. pack count over per-item size).
export function parseLastSize(sizeText: string): SizeInfo | undefined {
  return parseSizeMatch(sizeText, true);
}

export function parsePrice(priceText: string): number {
  const priceMatch = PRICE_PATTERN.exec(priceText);
  if (!priceMatch?.[0]) return Number.NaN;
  return Number(stripPriceFormatting(priceMatch[0]));
}

export function formatPricePerUnit(price: number, unit: string): string {
  let decimals = DECIMALS_DEFAULT;
  if (price < VERY_SMALL_PRICE) {
    decimals = DECIMALS_VERY_SMALL;
  } else if (price < FRACTIONAL_PRICE) {
    decimals = DECIMALS_FRACTIONAL;
  }
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
