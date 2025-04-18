import { COUNTRIES, CountryInfo } from '@constants/countries';

/**
 * Get all country codes for batch processing
 */
export const getAllCountryCodes = (): string[] => {
  return COUNTRIES.map(country => country.code);
};

/**
 * Get a subset of country codes based on priority
 * @param count Number of countries to return (default: 5)
 */
export const getPriorityCountryCodes = (count: number = 5): string[] => {
  // Return the first 'count' countries from our list
  return COUNTRIES.slice(0, count).map(country => country.code);
};

/**
 * Format price with currency symbol
 * @param price Price value
 * @param countryCode Country code
 */
export const formatPrice = (price: number | null, countryCode: string): string => {
  if (price === null) return 'N/A';
  
  const country = COUNTRIES.find(c => c.code === countryCode);
  if (!country) return `${price}`;
  
  return `${country.currencySymbol}${price.toFixed(2)}`;
};

/**
 * Get currency symbol for a country
 * @param countryCode Country code
 */
export const getCurrencySymbol = (countryCode: string): string => {
  const country = COUNTRIES.find(c => c.code === countryCode);
  return country ? country.currencySymbol : '$';
};

/**
 * Get currency code for a country
 * @param countryCode Country code
 */
export const getCurrencyCode = (countryCode: string): string => {
  const country = COUNTRIES.find(c => c.code === countryCode);
  return country ? country.currency : 'USD';
}; 