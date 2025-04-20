// Using require for node-fetch v2 compatibility with CommonJS
const fetch = require('node-fetch');
import * as cheerio from 'cheerio';
import logger from './logger';

// Define interfaces for structure and clarity

// Base result for IMDb (remains flat)
interface ImdbScrapeResult {
    rating: number | null;
    ratingCount: number | null;
    sourceUrl?: string;
    error?: string | null;
}

// Nested structure for Rotten Tomatoes data
interface RtCriticData {
    score: number | null; // Tomatometer score
    ratingCount: number | null; // Critic review count
    certified: boolean | null; // Certified Fresh status
    sentiment: string | null; // e.g., "POSITIVE", "NEGATIVE"
    consensus?: string | null; // Critic consensus text
}

interface RtAudienceData {
    score: number | null; // Audience score
    ratingCount: number | null; // Parsed audience rating/review count (numeric)
    certified: boolean | null; // Verified audience status?
    sentiment: string | null; // e.g., "POSITIVE", "NEGATIVE"
    consensus?: string | null; // Audience consensus text
}

interface RtScrapeResult {
    critic: RtCriticData | null;
    audience: RtAudienceData | null;
    sourceUrl?: string;
    error?: string | null;
}

// Main data structure combining results
interface RatingsData {
    imdb: ImdbScrapeResult | null;
    rottenTomatoes: RtScrapeResult | null;
}

interface ScraperInputEvent {
    imdbId: string;
    rottenTomatoesUrl: string; // Expect the full URL
}

interface APIGatewayEvent {
    body: string;
    headers: Record<string, string>;
    httpMethod: string;
    path: string;
    queryStringParameters: Record<string, string> | null;
    pathParameters: Record<string, string> | null;
    stageVariables: Record<string, string> | null;
    requestContext: any;
    resource: string;
}

interface APIGatewayResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
}

/**
 * Fetches HTML content from a given URL.
 * @param url The URL to fetch.
 * @returns Promise<string> The HTML content as a string.
 */
async function fetchHtml(url: string): Promise<string> {
    const response = await fetch(url, {
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            // Add other headers if needed to better mimic a browser
        },
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return await response.text();
}

/**
 * Parses IMDb HTML to extract ratings data.
 * Note: Selectors are based on observed structure (as of late 2023/early 2024) and may break.
 * @param html The HTML content of the IMDb page.
 * @param url The URL fetched, for context in errors/results.
 * @returns ImdbScrapeResult The extracted rating data.
 */
function parseImdbHtml(html: string, url: string): ImdbScrapeResult {
    try {
        const $ = cheerio.load(html);
        let rating: number | null = null;
        let ratingCount: number | null = null;
        let jsonParsed = false;

        // Attempt 1: Parse JSON-LD
        $('script[type="application/ld+json"]').each((_, element) => {
            try {
                const scriptContent = $(element).html();
                if (!scriptContent) return;
                const jsonData = JSON.parse(scriptContent);

                // Check if it's the main Movie schema and has aggregateRating
                if ((jsonData['@type'] === 'Movie' || jsonData['@type'] === 'TVSeries') && jsonData.aggregateRating) {
                    const aggRating = jsonData.aggregateRating;
                    if (aggRating.ratingValue) {
                        rating = parseFloat(String(aggRating.ratingValue));
                    }
                    if (aggRating.ratingCount) {
                        ratingCount = parseInt(String(aggRating.ratingCount), 10);
                    }
                    // If we found both rating and count in JSON, we can likely stop
                    if (rating !== null && ratingCount !== null) {
                        jsonParsed = true;
                        return false; // Exit .each loop
                    }
                }
            } catch (e) {
                logger.warn(`Error parsing JSON-LD from ${url}:`, e);
                // Continue trying other script tags or fall back to selectors
            }
        });

        // Attempt 2: Fallback to CSS Selectors if JSON-LD failed or was incomplete
        if (rating === null || ratingCount === null) {
            logger.info(`JSON-LD parsing incomplete for IMDb ${url}, falling back to selectors.`);
            // Selector for rating value (e.g., "8.7")
            const ratingSelector = '[data-testid="hero-rating-bar__aggregate-rating__score"] > span:first-child';
            // Selector for rating count: Last div child within the main rating container
            const ratingCountSelector =
                'div[class*="RatingBar__RatingCount"] , [data-testid="hero-rating-bar__aggregate-rating"] > div:last-child'; // Combine previous attempts

            const ratingStr = $(ratingSelector).first().text().trim();
            const ratingCountStr = $(ratingCountSelector).first().text().trim().toUpperCase();

            if (rating === null && ratingStr) {
                // Only update if not found in JSON
                rating = parseFloat(ratingStr);
            }

            if (ratingCount === null && ratingCountStr) {
                // Only update if not found in JSON
                const numPart = parseFloat(ratingCountStr.replace(/[^0-9.]/g, ''));
                if (!isNaN(numPart)) {
                    if (ratingCountStr.includes('M')) {
                        ratingCount = Math.round(numPart * 1000000);
                    } else if (ratingCountStr.includes('K')) {
                        ratingCount = Math.round(numPart * 1000);
                    } else {
                        ratingCount = parseInt(ratingCountStr.replace(/[^0-9]/g, ''), 10);
                    }
                }
            }
        }

        // Basic validation
        rating = rating !== null && !isNaN(rating) ? rating : null;
        ratingCount = ratingCount !== null && !isNaN(ratingCount) ? ratingCount : null;

        if (rating === null || ratingCount === null) {
            logger.warn(`Could not parse IMDb rating/count from ${url} using JSON-LD or selectors.`, {
                rating,
                ratingCount,
            });
        }

        return {
            rating,
            ratingCount,
            sourceUrl: url,
            error: null,
        };
    } catch (error: any) {
        logger.error(`Error parsing IMDb HTML from ${url}:`, error);
        return { rating: null, ratingCount: null, sourceUrl: url, error: `IMDb parse failed: ${error.message}` };
    }
}

/**
 * Parses Rotten Tomatoes HTML to extract ratings data.
 * Returns a nested structure with critic and audience data.
 * @param html The HTML content of the Rotten Tomatoes page.
 * @param url The URL fetched, for context in errors/results.
 * @returns RtScrapeResult The extracted rating data.
 */
function parseRottenTomatoesHtml(html: string, url: string): RtScrapeResult {
    try {
        const $ = cheerio.load(html);

        // Variables for JSON-LD parsing
        let jsonCriticScore: number | null = null;
        let jsonAudienceScore: number | null = null;
        let jsonConsensus: string | null = null;
        let jsonAudienceConsensus: string | null = null;
        let jsonAudienceReviewCount: number | null = null;
        let jsonCriticReviewCount: number | null = null;

        // Variables for fallback parsing
        let fallbackCriticScore: number | null = null;
        let fallbackAudienceScore: number | null = null;
        let fallbackConsensus: string | null = null;
        let fallbackAudienceConsensus: string | null = null;
        let fallbackAudienceReviewCount: number | null = null;
        let fallbackCriticReviewCount: number | null = null;
        let fallbackCriticCertified: boolean | null = null;
        let fallbackCriticSentiment: string | null = null;
        let fallbackAudienceCertified: boolean | null = null;
        let fallbackAudienceSentiment: string | null = null;
        let iconCriticScore: number | null = null;
        let didFallbackParseCertifiedSentiment = false;

        // --- Attempt 1: Parse JSON-LD ---
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const scriptContent = $(el).html();
                if (!scriptContent) return;
                const jsonData = JSON.parse(scriptContent);

                // Check for Movie/TVSeries type and aggregateRating (Critic Score)
                if ((jsonData['@type'] === 'Movie' || jsonData['@type'] === 'TVSeries') && jsonData.aggregateRating) {
                    const rawCriticScore = jsonData.aggregateRating.ratingValue;
                    if (typeof rawCriticScore === 'number' || typeof rawCriticScore === 'string') {
                        jsonCriticScore = parseInt(String(rawCriticScore), 10);
                    }
                    if (
                        typeof jsonData.aggregateRating.reviewCount === 'number' ||
                        typeof jsonData.aggregateRating.reviewCount === 'string'
                    ) {
                        jsonCriticReviewCount = parseInt(String(jsonData.aggregateRating.reviewCount), 10);
                    }
                }

                // Some RT JSON-LD includes audience ratings separately
                if (jsonData.audience?.aggregateRating) {
                    jsonAudienceScore = parseInt(String(jsonData.audience.aggregateRating.ratingValue), 10);
                    jsonAudienceReviewCount = parseInt(String(jsonData.audience.aggregateRating.ratingCount), 10); // Assuming 'ratingCount' here
                }

                // Extract consensus from review body or description
                if (jsonData.review?.reviewBody) {
                    jsonConsensus = jsonData.review.reviewBody.trim();
                } else if (
                    !jsonConsensus &&
                    typeof jsonData.description === 'string' &&
                    jsonData.description.length < 250
                ) {
                    // Use description as fallback consensus only if short and no review body found
                    // consensus = jsonData.description.trim(); // Uncomment if desired
                }

                // Check if we got the main scores from JSON
                if (
                    jsonCriticScore !== null &&
                    jsonCriticReviewCount !== null &&
                    jsonAudienceScore !== null &&
                    jsonAudienceReviewCount !== null &&
                    jsonConsensus !== null
                ) {
                    didFallbackParseCertifiedSentiment = true;
                    return false; // Exit loop
                }
            } catch (e) {
                logger.warn(`Error parsing JSON-LD from ${url}:`, e);
            }
        });

        // --- Attempt 2: Parse Fallback Selectors (media-scorecard, etc.) ---
        logger.info(`Checking RT selectors fallback for scores/certified/sentiment on ${url}...`);
        const scoreCard = $('media-scorecard');
        if (scoreCard.length > 0) {
            const scoreElement = scoreCard.find('rt-text[slot="criticsScore"]').first();
            const scoreText = scoreElement.text().trim();
            fallbackCriticScore = scoreText ? parseInt(scoreText.replace('%', ''), 10) : null;
            if (scoreText && isNaN(fallbackCriticScore ?? NaN)) {
                fallbackCriticScore = null;
            }
            const criticCountText = scoreCard.find('rt-link[slot="criticsReviews"]').first().text().trim();
            fallbackCriticReviewCount = criticCountText ? parseInt(criticCountText.replace(/[^0-9]/g, ''), 10) : null;

            const audienceScoreText = scoreCard.find('rt-text[slot="audienceScore"]').first().text().trim();
            fallbackAudienceScore = audienceScoreText ? parseInt(audienceScoreText.replace('%', ''), 10) : null;

            const audienceCountText = scoreCard.find('rt-link[slot="audienceReviews"]').first().text().trim();
            const audienceMatch = audienceCountText.match(/^[0-9,]+/);
            fallbackAudienceReviewCount = audienceMatch ? parseInt(audienceMatch[0].replace(/,/g, ''), 10) : null;

            const criticIcon = scoreCard.find('score-icon-critics');
            fallbackCriticCertified = criticIcon.attr('certified') === 'true';
            fallbackCriticSentiment = criticIcon.attr('sentiment') || null;
            const iconScoreAttr = criticIcon.attr('score');
            if (iconScoreAttr) {
                iconCriticScore = parseInt(iconScoreAttr, 10);
                if (isNaN(iconCriticScore)) {
                    iconCriticScore = null;
                }
            }

            const audienceIcon = scoreCard.find('score-icon-audience');
            fallbackAudienceCertified = audienceIcon.attr('certified') === 'true';
            fallbackAudienceSentiment = audienceIcon.attr('sentiment') || null;

            // Mark if we successfully parsed certified/sentiment via fallback
            if (fallbackCriticCertified !== null && fallbackCriticSentiment !== null) {
                didFallbackParseCertifiedSentiment = true;
            }
        } else {
            logger.warn(`Could not find media-scorecard element on ${url} for fallback parsing.`);
        }

        // Parse fallback consensus
        fallbackConsensus =
            $('#critics-consensus p').first().text().trim() ||
            $('[data-qa="critics-consensus"] p').first().text().trim();
        if (!fallbackConsensus) {
            fallbackConsensus = $('.consensus-text')
                .text()
                .trim()
                .replace(/^Critics Consensus:\s*/i, '');
        }

        // Parse audience consensus
        fallbackAudienceConsensus =
            $('#audience-consensus p').first().text().trim() ||
            $('[data-qa="audience-consensus"] p').first().text().trim();
        if (!fallbackAudienceConsensus) {
            fallbackAudienceConsensus = $('#audience-consensus .consensus-text')
                .text()
                .trim()
                .replace(/^Audience Says:\s*/i, '');
        }

        // --- Decision Logic & Structure Assembly ---
        let finalCriticScore: number | null;
        if (iconCriticScore !== null) {
            finalCriticScore = iconCriticScore;
        } else if (didFallbackParseCertifiedSentiment && fallbackCriticScore !== null) {
            finalCriticScore = fallbackCriticScore;
        } else {
            finalCriticScore = jsonCriticScore ?? fallbackCriticScore;
        }
        const finalCriticCount = jsonCriticReviewCount ?? fallbackCriticReviewCount;
        const finalAudienceScore = jsonAudienceScore ?? fallbackAudienceScore;
        const finalAudienceCount = jsonAudienceReviewCount ?? fallbackAudienceReviewCount;
        const finalConsensus = jsonConsensus ?? fallbackConsensus;
        const finalAudienceConsensus = jsonAudienceConsensus ?? fallbackAudienceConsensus;
        const finalCriticCertified = fallbackCriticCertified;
        const finalCriticSentiment = fallbackCriticSentiment;
        const finalAudienceCertified = fallbackAudienceCertified;
        const finalAudienceSentiment = fallbackAudienceSentiment;

        // Validate final values
        const validatedCriticScore = finalCriticScore !== null && !isNaN(finalCriticScore) ? finalCriticScore : null;
        const validatedCriticCount = finalCriticCount !== null && !isNaN(finalCriticCount) ? finalCriticCount : null;
        const validatedAudienceScore =
            finalAudienceScore !== null && !isNaN(finalAudienceScore) ? finalAudienceScore : null;
        const validatedAudienceCount =
            finalAudienceCount !== null && !isNaN(finalAudienceCount) ? finalAudienceCount : null;

        const criticData: RtCriticData = {
            score: validatedCriticScore,
            ratingCount: validatedCriticCount,
            certified: finalCriticCertified,
            sentiment: finalCriticSentiment,
            consensus: finalConsensus || null,
        };

        const audienceData: RtAudienceData = {
            score: validatedAudienceScore,
            ratingCount: validatedAudienceCount,
            certified: finalAudienceCertified,
            sentiment: finalAudienceSentiment,
            consensus: finalAudienceConsensus || null,
        };

        return {
            critic:
                criticData.score !== null || criticData.ratingCount !== null || criticData.consensus !== null
                    ? criticData
                    : null,
            audience: audienceData.score !== null || audienceData.ratingCount !== null || audienceData.consensus !== null
                    ? audienceData
                    : null,
            sourceUrl: url,
            error: null,
        };
    } catch (error: any) {
        logger.error(`Error parsing Rotten Tomatoes HTML from ${url}:`, error);
        return {
            critic: null,
            audience: null,
            sourceUrl: url,
            error: `Rotten Tomatoes parse failed: ${error.message}`,
        };
    }
}

/**
 * Scrapes ratings data from IMDb and Rotten Tomatoes for a given movie/show.
 * @param imdbId The IMDb ID (e.g., "tt0111161").
 * @param rottenTomatoesUrl The full URL to the Rotten Tomatoes page.
 * @returns Promise<RatingsData> Object containing scraped data from both sources.
 */
export async function scrapeRatings(imdbId: string | null, rottenTomatoesUrl: string | null): Promise<RatingsData> {
    const result: RatingsData = {
        imdb: null,
        rottenTomatoes: null,
    };

    if (imdbId) {
        const imdbUrl = `https://www.imdb.com/title/${imdbId}/`;
        try {
            logger.info(`Fetching IMDb page: ${imdbUrl}`);
            const imdbHtml = await fetchHtml(imdbUrl);
            logger.info(`Parsing IMDb page for ${imdbId}`);
            result.imdb = parseImdbHtml(imdbHtml, imdbUrl);
        } catch (error: any) {
            logger.error(`Failed to scrape IMDb (${imdbId}): ${error.message}`);
            result.imdb = {
                rating: null,
                ratingCount: null,
                sourceUrl: imdbUrl,
                error: `IMDb scrape failed: ${error.message}`,
            };
        }
    } else {
        logger.info('No IMDb ID provided, skipping IMDb scrape.');
    }

    if (rottenTomatoesUrl) {
        try {
            logger.info(`Fetching Rotten Tomatoes page: ${rottenTomatoesUrl}`);
            const rtHtml = await fetchHtml(rottenTomatoesUrl);
            logger.info(`Parsing Rotten Tomatoes page: ${rottenTomatoesUrl}`);
            result.rottenTomatoes = parseRottenTomatoesHtml(rtHtml, rottenTomatoesUrl);
        } catch (error: any) {
            logger.error(`Failed to scrape Rotten Tomatoes (${rottenTomatoesUrl}): ${error.message}`);
            result.rottenTomatoes = {
                critic: null,
                audience: null,
                sourceUrl: rottenTomatoesUrl,
                error: `Rotten Tomatoes scrape failed: ${error.message}`,
            };
        }
    } else {
        logger.info('No Rotten Tomatoes URL provided, skipping RT scrape.');
    }

    return result;
}

/**
 * AWS Lambda handler function.
 * Expects an event object with imdbId and rottenTomatoesUrl.
 */
export const handler = async (event: APIGatewayEvent): Promise<APIGatewayResponse> => {
    try {
        // Parse the request body
        const input: ScraperInputEvent = JSON.parse(event.body);

        if (!input.imdbId && !input.rottenTomatoesUrl) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'At least one of imdbId or rottenTomatoesUrl is required',
                }),
            };
        }

        // Call the main scraping function
        const result = await scrapeRatings(input.imdbId, input.rottenTomatoesUrl);

        // Log the result for monitoring
        logger.info('Scraping completed successfully:', {
            imdbId: input.imdbId,
            rtUrl: input.rottenTomatoesUrl,
            result,
        });

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify(result),
        };
    } catch (error: any) {
        logger.error('Error in Lambda handler:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message,
            }),
        };
    }
};

// --- Local testing ---

async function testScrape() {
    // Example: The Shawshank Redemption
    const imdbId = 'tt0111161';
    const rottenTomatoesUrl = 'https://www.rottentomatoes.com/m/shawshank_redemption';

    // Example: Oppenheimer (more recent)
    //  const imdbId = 'tt15398776';
    //  const rottenTomatoesUrl = 'https://www.rottentomatoes.com/m/oppenheimer_2023';

    logger.info(`--- Starting local test scrape for IMDb ID: ${imdbId}, RT URL: ${rottenTomatoesUrl} ---`);
    const results = await scrapeRatings(imdbId, rottenTomatoesUrl);
    logger.info('--- Local test scrape finished ---');
    logger.info('Results:');
    logger.info(JSON.stringify(results, null, 2));
}

// Check if the script is being run directly (e.g., `node dist/services/scraping/ratingsScraper.js`)
if (require.main === module) {
    testScrape().catch(error => {
        logger.error('Local test scrape failed:', error);
        process.exit(1);
    });
}

// TODO: Refine selectors further based on testing with various movie/TV pages.
// TODO: Implement more sophisticated error handling/retries if needed.
