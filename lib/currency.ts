// Currency utilities for multi-currency support
// Each currency maintains its own independent balance flow within a group

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  flag: string;
}

const CURRENCIES: Record<string, CurrencyInfo> = {
  BRL: { code: 'BRL', symbol: 'R$', name: 'Real', flag: '🇧🇷' },
  USD: { code: 'USD', symbol: '$', name: 'Dólar', flag: '🇺🇸' },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', flag: '🇪🇺' },
  GBP: { code: 'GBP', symbol: '£', name: 'Libra', flag: '🇬🇧' },
};

export const DEFAULT_CURRENCY = 'BRL';

/**
 * Get the symbol for a currency code (e.g., 'BRL' → 'R$')
 */
export function getCurrencySymbol(currency: string): string {
  return CURRENCIES[currency]?.symbol || currency;
}

/**
 * Format an amount with the appropriate currency symbol
 * e.g., formatCurrency(30.62, 'BRL') → 'R$30.62'
 * e.g., formatCurrency(120, 'USD') → '$120.00'
 */
export function formatCurrency(amount: number | string, currency: string = DEFAULT_CURRENCY): string {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  const symbol = getCurrencySymbol(currency);
  return `${symbol}${Math.abs(numAmount).toFixed(2)}`;
}

/**
 * Format an amount with sign prefix for statement views
 * e.g., formatCurrencyWithSign(30.62, 'BRL') → '+ R$ 30.62'
 * e.g., formatCurrencyWithSign(-120, 'USD') → '- $ 120.00'
 */
export function formatCurrencyWithSign(amount: number, currency: string = DEFAULT_CURRENCY): string {
  const symbol = getCurrencySymbol(currency);
  const sign = amount >= 0 ? '+' : '-';
  return `${sign} ${symbol} ${Math.abs(amount).toFixed(2)}`;
}

/**
 * Get list of all supported currencies for selector UI
 */
export function getSupportedCurrencies(): CurrencyInfo[] {
  return Object.values(CURRENCIES);
}
