import chromium from 'chrome-aws-lambda';
import type { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { logger } from '../../utils/logger';
import type { Page, Browser } from 'puppeteer-core';

const DIRECTOR_SELECTOR = '[data-attrid="kc:/film/film:director"]';

export interface WatchOption {
    link: string;
    name: string;
    price?: string;
}

export interface Rating {
    rating: string;
    name: string;
    link: string;
}

export interface GoogleSearchResult {
    ratings: Rating[];
    allWatchOptions: WatchOption[];
    imdbId: string | null;
    debugText?: string;
    directorName: string | null;
    region: string;
}

const priceMapper = (price: string): string => {
    if (!price) return '';
    if (price.toLowerCase().includes('free')) {
        return 'Free';
    }
    return price.replace('.00', '');
};

export class GoogleKnowledgePanelScraper {
    private browser: Browser | null = null;
    private page: Page | null = null;

    async initialize() {
        const executablePath = await chromium.executablePath;
        if (!executablePath) {
            throw new Error('Chrome executable path not found');
        }

        this.browser = await chromium.puppeteer.launch({
            args: [
                ...chromium.args,
                '--no-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--single-process',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--font-render-hinting=none',
            ],
            defaultViewport: chromium.defaultViewport,
            executablePath,
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        this.page = await this.browser.newPage();
        if (!this.page) {
            throw new Error('Failed to create new page');
        }

        await this.page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
        await this.page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }
    }

    private async extractTextFromElement(element: any): Promise<string | null> {
        if (!element) return null;
        const textProperty = await element.getProperty('innerText');
        if (!textProperty) return null;
        return (await textProperty.jsonValue()) as string;
    }

    private async extractHrefFromElement(element: any): Promise<string | null> {
        if (!element) return null;
        const hrefProperty = await element.getProperty('href');
        if (!hrefProperty) return null;
        return (await hrefProperty.jsonValue()) as string;
    }

    private async extractRatings(): Promise<{ ratings: Rating[]; imdbId: string | null }> {
        const ratings: Rating[] = [];
        let imdbId: string | null = null;

        const ratingsDOM = await this.page!.$$('a.vIUFYd');

        for (const ratingDOM of ratingsDOM) {
            const ratingSpan = await ratingDOM.$('span.KMdzJ');
            const nameSpan = await ratingDOM.$('span.pVA7K');
            const linkStr = await this.extractHrefFromElement(ratingDOM);

            if (ratingSpan && nameSpan && linkStr) {
                const ratingValue = await this.extractTextFromElement(ratingSpan);
                const nameValue = await this.extractTextFromElement(nameSpan);

                if (ratingValue && nameValue) {
                    if (linkStr.includes('/title/')) {
                        imdbId = linkStr.split('/title/')[1].split('/')[0];
                    }
                    ratings.push({
                        rating: ratingValue,
                        name: nameValue,
                        link: linkStr,
                    });
                }
            }
        }

        // Extract Google rating if available
        const googleRatingDOM = await this.page!.$('div.srBp4');
        if (googleRatingDOM) {
            const googleRatingValue = await this.extractTextFromElement(googleRatingDOM);
            if (googleRatingValue) {
                const googleRating = `${googleRatingValue.split('%')[0]}%`;
                if (!isNaN(parseInt(googleRating.split('%')[0]))) {
                    ratings.push({
                        rating: googleRating,
                        name: 'google',
                        link: this.page!.url(),
                    });
                }
            }
        }

        return { ratings, imdbId };
    }

    private async extractDirector(): Promise<string | null> {
        const directorDOM = await this.page!.$(DIRECTOR_SELECTOR);
        if (!directorDOM) return null;

        const directorText = await this.extractTextFromElement(directorDOM);
        if (!directorText) return null;

        return directorText.split(':')[1]?.trim() || null;
    }

    private async extractWatchOptionsFromPrimarySource(): Promise<WatchOption[]> {
        const watchOptions: WatchOption[] = [];
        const watchOptionsDOM = await this.page!.$('span.hVUO8e');

        if (!watchOptionsDOM) return watchOptions;

        await watchOptionsDOM.click();
        await this.page!.waitForSelector('g-expandable-content.rXtXab', {
            timeout: 2000,
        });

        const ottDOMContainer = await this.page!.$('g-expandable-content.rXtXab');
        if (!ottDOMContainer) return watchOptions;

        const ottDOMs = await ottDOMContainer.$$('a');
        for (const ottDom of ottDOMs) {
            const link = await this.extractHrefFromElement(ottDom);
            if (!link) continue;

            const nameDiv = await ottDom.$('div.bclEt');
            const name = await this.extractTextFromElement(nameDiv);
            if (!name) continue;

            const priceDiv = await ottDom.$('div.rsj3fb');
            const price = await this.extractTextFromElement(priceDiv);

            watchOptions.push({
                link,
                name,
                ...(price ? { price } : {}),
            });
        }

        return watchOptions;
    }

    private async extractWatchOptionsFromSecondarySource(): Promise<WatchOption[]> {
        const watchOptions: WatchOption[] = [];
        const secondaryWatchOptionsDOM = await this.page!.$('div.nGOerd');

        if (!secondaryWatchOptionsDOM) return watchOptions;

        try {
            const expandButton = await this.page!.$('.zu8h9c');
            if (expandButton) {
                await expandButton.click();
                await this.page!.waitForSelector('.zu8h9c[aria-expanded="true"]', {
                    timeout: 2000,
                });
            }
        } catch (e) {
            // Ignore expansion errors
        }

        const ottDOMs = await this.page!.$$('div.nGOerd a');
        for (const ottDom of ottDOMs) {
            const link = await this.extractHrefFromElement(ottDom);
            if (!link) continue;

            const nameDiv = await ottDom.$('div.bclEt');
            let name = await this.extractTextFromElement(nameDiv);

            if (!name) {
                name = new URL(link).hostname;
            }

            let price = '';
            try {
                const priceDiv1 = await ottDom.$('div.rsj3fb');
                const priceDiv2 = await ottDom.$('div.ZYHQ7e');

                if (priceDiv1) {
                    price = (await this.extractTextFromElement(priceDiv1)) || '';
                } else if (priceDiv2) {
                    price = (await this.extractTextFromElement(priceDiv2)) || '';
                }
            } catch (e) {
                // Ignore price extraction errors
            }

            watchOptions.push({
                link,
                name,
                price: priceMapper(price),
            });
        }

        return watchOptions;
    }

    private async extractWatchOptionsFromFallbackSource(): Promise<WatchOption[]> {
        const watchOptions: WatchOption[] = [];
        const res = await this.page!.$('div.fOYFme>a');

        if (!res) return watchOptions;

        const link = await this.extractHrefFromElement(res);
        if (!link) return watchOptions;

        const hostname = new URL(link).hostname;
        const mainLink: WatchOption = {
            link,
            name: hostname,
        };

        let priceDom = await res.$('span');
        if (!priceDom) {
            priceDom = await res.$('.uiBRm');
        }

        if (priceDom) {
            const price = await this.extractTextFromElement(priceDom);
            if (price) {
                mainLink.price = priceMapper(price);
            }
        }

        watchOptions.push(mainLink);
        return watchOptions;
    }

    private squashWatchOptions(watchOptions: WatchOption[]): WatchOption[] {
        const uniqueWatchOptions = new Map<string, WatchOption>();

        for (const option of watchOptions) {
            const existingOption = uniqueWatchOptions.get(option.link);

            // If this option doesn't exist yet, or if this option has price info and the existing one doesn't
            if (!existingOption || (option.price && !existingOption.price)) {
                uniqueWatchOptions.set(option.link, option);
            }
        }

        return Array.from(uniqueWatchOptions.values());
    }

    async scrape(searchString: string, region: string): Promise<GoogleSearchResult> {
        if (!this.page) {
            throw new Error('Browser not initialized. Call initialize() first.');
        }

        try {
            await this.page.goto(`https://www.google.com/search?q=${searchString}&gl=${region}`, {
                waitUntil: 'domcontentloaded',
            });

            // Extract ratings and IMDB ID
            const { ratings, imdbId } = await this.extractRatings();

            // Extract director name
            const directorName = await this.extractDirector();

            // Extract watch options from all possible sources
            const primaryWatchOptions = await this.extractWatchOptionsFromPrimarySource();
            const secondaryWatchOptions = await this.extractWatchOptionsFromSecondarySource();
            const fallbackWatchOptions = await this.extractWatchOptionsFromFallbackSource();

            // Combine all watch options
            const allWatchOptions = [...primaryWatchOptions, ...secondaryWatchOptions, ...fallbackWatchOptions];

            // Squash watch links by unique link, prioritizing those with price information
            const squashedWatchOptions = this.squashWatchOptions(allWatchOptions);

            // Extract debug text if needed
            let debugText = '';
            if (!ratings.length) {
                const bodyElement = await this.page.$('body');
                if (bodyElement) {
                    debugText = (await this.extractTextFromElement(bodyElement)) || '';
                }
            }

            return {
                ratings,
                allWatchOptions: squashedWatchOptions,
                imdbId,
                debugText,
                directorName,
                region,
            };
        } catch (error) {
            logger.error('Error in Google scraper:', error);
            throw error;
        }
    }
}

export const handler = async (event: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
    const scraper = new GoogleKnowledgePanelScraper();

    try {
        const body = JSON.parse(event.body || '{}') as { searchString?: string; region?: string };
        const searchString = body.searchString;
        const region = body.region;

        if (!searchString) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'Missing required field: searchString',
                }),
            };
        }

        if (!region) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'Missing required field: region',
                }),
            };
        }

        await scraper.initialize();
        const result = await scraper.scrape(searchString, region);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify(result),
        };
    } catch (error) {
        logger.error('Error in Google scraper:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error',
            }),
        };
    } finally {
        await scraper.close();
    }
};
