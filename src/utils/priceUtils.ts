import { getCurrencySymbol } from '@utils/countryUtils';
import logger from '@utils/logger';

/**
 * Parse price information from a raw price string
 * @param rawPrice Raw price string from the source
 * @returns Object with parsed price information
 */
export interface PriceInfo {
  price: number | null;
  rawPrice: string | null;
  isSubscription: boolean;
  isFree: boolean;
}

export const parsePrice = (rawPrice: string | null): PriceInfo => {
  const result: PriceInfo = {
    price: null,
    rawPrice: rawPrice,
    isSubscription: false,
    isFree: false
  };
  
  if (!rawPrice) {
    return result;
  }
  
  const lowerPrice = rawPrice.toLowerCase();
  
  // Check if it's a subscription
  if (lowerPrice.includes('subscription') || 
      lowerPrice.includes('sub') ||
      lowerPrice.includes('monthly') ||
      lowerPrice.includes('yearly') ||
      lowerPrice.includes('annual')) {
    result.isSubscription = true;
  }
  
  // Check if it's free
  if (lowerPrice.includes('free') || 
      lowerPrice === '0' ||
      lowerPrice === '$0' ||
      lowerPrice === '£0' ||
      lowerPrice === '€0' ||
      lowerPrice === '¥0' ||
      lowerPrice === '₹0' ||
      lowerPrice === 'r$0' ||
      lowerPrice === 'mex$0' ||
      lowerPrice === '₩0' ||
      lowerPrice === '₽0' ||
      lowerPrice === 'cny0') {
    result.isFree = true;
  }
  
  // Try to extract numeric price
  const priceMatch = rawPrice.match(/[\d,.]+/);
  if (priceMatch) {
    result.price = parseFloat(priceMatch[0].replace(/,/g, ''));
  }
  
  return result;
};

/**
 * Format a price with currency symbol
 * @param priceInfo Price information object
 * @param countryCode Country code for currency symbol
 * @returns Formatted price string
 */
export const formatPriceInfo = (priceInfo: PriceInfo, countryCode: string): string => {
  const currencySymbol = getCurrencySymbol(countryCode);
  
  if (priceInfo.isFree) {
    return 'Free';
  }
  
  if (priceInfo.isSubscription) {
    if (priceInfo.price) {
      return `${currencySymbol}${priceInfo.price.toFixed(2)}/month (Subscription)`;
    }
    return 'Subscription';
  }
  
  if (priceInfo.price) {
    return `${currencySymbol}${priceInfo.price.toFixed(2)}`;
  }
  
  return priceInfo.rawPrice || 'N/A';
};

/**
 * Determine the link type based on price information
 * @param priceInfo Price information object
 * @returns Link type: 'rent', 'buy', 'stream', or 'free'
 */
export const determineLinkType = (priceInfo: PriceInfo): string => {
  if (priceInfo.isFree) {
    return 'free';
  }
  
  if (priceInfo.isSubscription) {
    return 'stream';
  }
  
  if (priceInfo.price) {
    // If it has a price, assume it's a rental
    return 'rent';
  }
  
  // Default to stream if we can't determine
  return 'stream';
};

/**
 * Cleans a URL by removing known referral parameters
 * @param url The original URL
 * @returns Cleaned URL without referral parameters
 */
export const cleanReferralParameters = (url: string): string => {
  if (!url) return url;
  
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // List of known referral parameters to remove (general ones)
    const referralParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'ref_', 'ref', 'referrer', 'referral', 'source', 'gclid', 'fbclid', 'dclid'
    ];
    
    // Provider-specific parameters to remove
    const providerSpecificParams: Record<string, string[]> = {
      'hotstar.com': ['utm_source'],
      'primevideo.com': ['autoplay', 'ref_'],
      'tv.apple.com': ['action'],
      'play.google.com': ['hl', 'gl'],
      'netflix.com': ['trackId', 'tctx'],
      'youtube.com': ['feature']
    };
    
    // Store original URL for comparison
    const originalUrl = url;
    
    // Check if URL has parameters first
    if (urlObj.search) {
      const params = new URLSearchParams(urlObj.search);
      let paramRemoved = false;
      const removedParams: Record<string, string> = {};
      
      // Get provider-specific params if the hostname matches
      const specificParams = Object.keys(providerSpecificParams).find(domain => hostname.includes(domain));
      const paramsToRemove = [...referralParams];
      
      if (specificParams) {
        paramsToRemove.push(...providerSpecificParams[specificParams]);
      }
      
      // Remove known referral parameters
      for (const param of paramsToRemove) {
        if (params.has(param) || Array.from(params.keys()).some(key => key.startsWith(param))) {
          Array.from(params.keys())
            .filter(key => key === param || key.startsWith(`${param}_`) || key.startsWith(param))
            .forEach(key => {
              // Store removed parameter for logging
              removedParams[key] = params.get(key) || '';
              params.delete(key);
              paramRemoved = true;
            });
        }
      }
      
      // Only modify the URL if we actually removed parameters
      if (paramRemoved) {
        const newSearch = params.toString();
        urlObj.search = newSearch ? `?${newSearch}` : '';
        
        // For logging purposes
        logger.debug(`URL cleaned: Original: ${originalUrl}, Cleaned: ${urlObj.toString()}, Removed params: ${JSON.stringify(removedParams)}`);
        
        return urlObj.toString();
      }
    }
    
    // If no parameters were removed, return the original URL
    return url;
  } catch (error) {
    logger.error(`Error cleaning URL ${url}:`, error);
    // If URL parsing fails, return the original URL
    return url;
  }
}; 