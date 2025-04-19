import chromium from '@sparticuz/chromium';
import type { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import logger from './logger';
import puppeteer from 'puppeteer-core';
import type { Page, Browser, ElementHandle } from 'puppeteer-core';
import { randomBytes } from 'crypto';

const DIRECTOR_SELECTOR = '[data-attrid="kc:/film/film:director"]';
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

// Common screen resolutions
const COMMON_RESOLUTIONS = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 }
];

// Common time zones
const COMMON_TIMEZONES = [
    'America/New_York',
    'America/Los_Angeles',
    'America/Chicago',
    'Europe/London',
    'Europe/Paris'
];

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
    region?: string;
}

interface ProxyConfig {
    host: string;
    port: number;
    username?: string;
    password?: string;
}

interface Fingerprint {
    deviceMemory: number;
    hardwareConcurrency: number;
    platform: string;
}

const priceMapper = (price: string): string => {
    if (!price) return '';
    if (price.toLowerCase().includes('free')) {
        return 'Free';
    }
    return price.replace('.00', '');
};

// Helper to generate random delays with natural distribution
const randomDelay = (min: number, max: number): number => {
    // Use a normal distribution for more natural timing
    const mean = (min + max) / 2;
    const stdDev = (max - min) / 6;
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const value = Math.floor(mean + stdDev * z0);
    return Math.max(min, Math.min(max, value));
};

// Get random item from array
const getRandomItem = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export class GoogleKnowledgePanelScraper {
    private browser: Browser | null = null;
    private page: Page | null = null;
    private currentProxy: ProxyConfig | null = null;
    private retryCount: number = 0;

    constructor(private readonly proxyList?: ProxyConfig[]) {}

    private async rotateProxy(): Promise<ProxyConfig | null> {
        if (!this.proxyList || this.proxyList.length === 0) return null;
        this.currentProxy = getRandomItem(this.proxyList);
        return this.currentProxy;
    }

    private async setupPage(page: Page) {
        const resolution = getRandomItem(COMMON_RESOLUTIONS);
        const timezone = getRandomItem(COMMON_TIMEZONES);

        // Generate a persistent fingerprint
        const fingerprint: Fingerprint = {
            deviceMemory: [2, 4, 8, 16][Math.floor(Math.random() * 4)],
            hardwareConcurrency: [2, 4, 6, 8][Math.floor(Math.random() * 4)],
            platform: ['Win32', 'MacIntel'][Math.floor(Math.random() * 2)],
        };

        await page.evaluateOnNewDocument((fp: Fingerprint, tz: string) => {
            // Override timezone
            const dateToString = Date.prototype.toString;
            const intlFormat = Intl.DateTimeFormat().resolvedOptions;
            Object.defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {
                get: () => () => ({ ...intlFormat.call(this), timeZone: tz })
            });
            Object.defineProperty(Date.prototype, 'toString', {
                get: () => () => dateToString.call(this).replace(/GMT[+-]\d{4}/, 'GMT-0500')
            });

            // Override hardware specs
            Object.defineProperty(navigator, 'deviceMemory', { get: () => fp.deviceMemory });
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => fp.hardwareConcurrency });
            Object.defineProperty(navigator, 'platform', { get: () => fp.platform });
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

            // Override screen properties
            Object.defineProperty(window.screen, 'colorDepth', { get: () => 24 });
            Object.defineProperty(window.screen, 'pixelDepth', { get: () => 24 });

            // Add touch support conditionally
            if (Math.random() > 0.5) {
                Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
            }

            // Override connection
            // @ts-ignore
            Object.defineProperty(navigator, 'connection', {
                get: () => ({
                    effectiveType: ['4g', '3g'][Math.floor(Math.random() * 2)],
                    rtt: Math.floor(Math.random() * 100),
                    downlink: 5 + Math.random() * 5,
                    saveData: false
                })
            });

            // Override permissions
            const originalQuery = window.navigator.permissions.query;
            // @ts-ignore
            window.navigator.permissions.query = (parameters: any) => 
                parameters.name === 'notifications' 
                    ? Promise.resolve({ state: Notification.permission }) 
                    : originalQuery(parameters);

            // Add plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => {
                    const plugins = new Array(3).fill(null).map(() => ({
                        name: randomBytes(10).toString('hex'),
                        filename: randomBytes(10).toString('hex'),
                        description: randomBytes(10).toString('hex'),
                        length: Math.floor(Math.random() * 5) + 1
                    }));
                    return plugins;
                }
            });

        }, fingerprint, timezone);

        // Set a more realistic user agent with OS version
        const chromeVersion = '120.0.0.0';
        const osVersion = fingerprint.platform === 'Win32' ? '10.0' : '10_15_7';
        const userAgent = fingerprint.platform === 'Win32'
            ? `Mozilla/5.0 (Windows NT ${osVersion}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
            : `Mozilla/5.0 (Macintosh; Intel Mac OS X ${osVersion}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;

        await page.setUserAgent(userAgent);

        // Set modern headers
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'sec-ch-ua': `"Not_A Brand";v="8", "Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}"`,
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': `"${fingerprint.platform === 'Win32' ? 'Windows' : 'macOS'}"`,
        });
    }

    async initialize() {
        const executablePath = await chromium.executablePath();
        if (!executablePath) {
            throw new Error('Chrome executable path not found');
        }

        // Rotate proxy if available
        const proxy = await this.rotateProxy();
        const proxyArgs = proxy ? [
            `--proxy-server=${proxy.host}:${proxy.port}`,
        ] : [];

        const resolution = getRandomItem(COMMON_RESOLUTIONS);

        this.browser = await puppeteer.launch({
            args: [
                ...chromium.args,
                ...proxyArgs,
                '--no-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-accelerated-2d-canvas',
                '--disable-blink-features',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-breakpad',
                '--disable-component-extensions-with-background-pages',
                '--disable-extensions',
                '--disable-features=TranslateUI,BlinkGenPropertyTrees',
                '--disable-ipc-flooding-protection',
                '--enable-features=NetworkService,NetworkServiceInProcess',
                '--force-color-profile=srgb',
                '--metrics-recording-only',
                '--font-render-hinting=none',
            ],
            defaultViewport: {
                width: resolution.width,
                height: resolution.height,
                deviceScaleFactor: 1,
                hasTouch: false,
                isLandscape: true,
                isMobile: false,
            },
            executablePath,
            headless: chromium.headless,
        });

        this.page = await this.browser.newPage();
        if (!this.page) {
            throw new Error('Failed to create new page');
        }

        // Set up proxy authentication if needed
        if (proxy && proxy.username && proxy.password) {
            await this.page.authenticate({
                username: proxy.username,
                password: proxy.password
            });
        }

        await this.setupPage(this.page);
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
        // Wait up to 500ms for a price DOM to appear
        await Promise.race([
            this.page!.waitForSelector('div.rsj3fb', { timeout: 500 }).catch(() => {}),
            this.page!.waitForSelector('div.ZYHQ7e', { timeout: 500 }).catch(() => {}),
        ]);

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

        let priceDom: ElementHandle<Element> | null = await res.$('span');
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

    async scrape(searchString: string, region?: string): Promise<GoogleSearchResult> {
        if (!this.page) {
            throw new Error('Browser not initialized. Call initialize() first.');
        }

        try {
            const searchUrl = new URL('https://www.google.com/search');
            searchUrl.searchParams.set('q', searchString);
            if (region) {
                searchUrl.searchParams.set('gl', region);
            }

            // Add random hl parameter for language
            searchUrl.searchParams.set('hl', 'en');
            
            // Add random parameters that real browsers send
            searchUrl.searchParams.set('source', 'hp');
            searchUrl.searchParams.set('ei', randomBytes(12).toString('hex'));
            searchUrl.searchParams.set('iflsig', randomBytes(12).toString('hex'));
            if (Math.random() > 0.5) {
                searchUrl.searchParams.set('oq', searchString);
            }

            // Simulate human typing in the search box
            await this.page.goto(searchUrl.toString(), { waitUntil: 'networkidle0', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, randomDelay(1000, 2000)));

            // // Type with random delays between keystrokes
            // const searchInput = await this.page.$('input[name="q"]');
            // if (searchInput) {
            //     for (const char of searchString) {
            //         await searchInput.type(char, { delay: randomDelay(100, 300) });
            //     }
            //     await new Promise(resolve => setTimeout(resolve, randomDelay(500, 1000)));
            //     await searchInput.press('Enter');
            // } else {
            //     // Fallback to direct URL if search box not found
            //     await this.page.goto(searchUrl.toString(), { waitUntil: 'networkidle0', timeout: 30000 });
            // }

            // Add natural scrolling behavior
            await this.page.evaluate(async () => {
                const scrollStep = () => {
                    const step = 10 + Math.random() * 30;
                    window.scrollBy(0, step);
                    return document.documentElement.scrollTop;
                };

                const maxScroll = Math.min(
                    document.documentElement.scrollHeight - window.innerHeight,
                    1000
                );

                let currentScroll = 0;
                while (currentScroll < maxScroll) {
                    currentScroll = scrollStep();
                    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
                }
            });

            // Check for captcha/detection
            const pageContent = await this.page.content();
            if (pageContent.includes('detected unusual traffic') || pageContent.includes('verify you are a human')) {
                this.retryCount++;
                if (this.retryCount < MAX_RETRIES) {
                    logger.warn(`Bot detected, retrying with new proxy (attempt ${this.retryCount})`);
                    await this.close();
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                    await this.initialize();
                    return this.scrape(searchString, region);
                }
                throw new Error('Bot detection limit reached after multiple retries');
            }

            // Reset retry count on successful request
            this.retryCount = 0;

            // Random delay before extraction
            await new Promise(resolve => setTimeout(resolve, randomDelay(500, 1500)));

            // Extract data with random delays between operations
            const { ratings, imdbId } = await this.extractRatings();
            await new Promise(resolve => setTimeout(resolve, randomDelay(300, 800)));

            const directorName = await this.extractDirector();
            await new Promise(resolve => setTimeout(resolve, randomDelay(400, 1000)));

            const primaryWatchOptions = await this.extractWatchOptionsFromPrimarySource();
            const secondaryWatchOptions = await this.extractWatchOptionsFromSecondarySource();
            const fallbackWatchOptions = await this.extractWatchOptionsFromFallbackSource();

            const allWatchOptions = [...primaryWatchOptions, ...secondaryWatchOptions, ...fallbackWatchOptions];
            const squashedWatchOptions = this.squashWatchOptions(allWatchOptions);

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
                ...(region ? { region } : {}),
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
        const body = JSON.parse(event.body || '{}') as { searchString?: string; region?: string; proxyList?: ProxyConfig[] };
        const { searchString, region, proxyList } = body;

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

        const scraper = new GoogleKnowledgePanelScraper(proxyList);
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
