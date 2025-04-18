export interface CountryInfo {
  code: string;
  name: string;
  currency: string;
  currencySymbol: string;
}

export const COUNTRIES: CountryInfo[] = [
  { code: 'US', name: 'United States', currency: 'USD', currencySymbol: '$' },
  { code: 'IN', name: 'India', currency: 'INR', currencySymbol: '₹' },
];

export const getCountryByCode = (code: string): CountryInfo | undefined => {
  return COUNTRIES.find(country => country.code === code);
};

export const getDefaultCountry = (): CountryInfo => {
  return COUNTRIES[0]; // US is the default
};
