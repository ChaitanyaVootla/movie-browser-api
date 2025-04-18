import { Knex } from 'knex';
import { scrapeRatings } from '@services/scraping/ratingsScraper';
import logger from '@utils/logger';

// Define interfaces for clarity
interface ExternalId {
    id: number;
    content_type: string;
    content_id: number;
    source: string;
    external_id: string;
    url: string | null;
}

interface RatingRecord {
    content_type: string;
    content_id: number;
    source: string;
    rating: number | null;
    rating_count: number | null;
    consensus: string | null;
    rating_type: string;
    details: Record<string, any> | null;
    last_updated: Date;
}

/**
 * Service to enrich content with ratings from external sources
 */
export class RatingsEnricher {
    constructor(private readonly db: Knex) {}

    /**
     * Process a single content item (movie or TV show) to enrich it with ratings
     * @param contentType 'movie' or 'tv'
     * @param contentId The ID of the content in our database
     * @returns Promise<boolean> Whether the enrichment was successful
     */
    async enrichContent(contentType: string, contentId: number): Promise<boolean> {
        try {
            // Get external IDs for this content
            const externalIds = await this.getExternalIds(contentType, contentId);

            if (!externalIds || externalIds.length === 0) {
                logger.info(`No external IDs found for ${contentType} ${contentId}`);
                return false;
            }

            // Find IMDb and Rotten Tomatoes IDs
            const imdbId = externalIds.find(id => id.source.toLowerCase() === 'imdb')?.external_id;
            const rtId = externalIds.find(id => id.source.toLowerCase() === 'rottentomatoes')?.external_id;
            let rtUrl = null;
            if (!imdbId && !rtId) {
                logger.info(`No IMDb ID or Rotten Tomatoes URL found for ${contentType} ${contentId}`);
                return false;
            }
            if (rtId) {
                rtUrl = `https://www.rottentomatoes.com/${rtId}`;
            }

            // Check if we already have ratings for this content
            const existingRatings = await this.getExistingRatings(contentType, contentId);

            // // If we have both IMDb and RT ratings, no need to scrape
            // if (
            //     existingRatings.some(r => r.source.toLowerCase() === 'imdb') &&
            //     existingRatings.some(r => r.source.toLowerCase() === 'rottentomatoes')
            // ) {
            //     logger.info(`Ratings already exist for ${contentType} ${contentId}`);
            //     return true;
            // }

            // Scrape ratings
            const scrapedRatings = await scrapeRatings(imdbId || null, rtUrl || null);

            // Insert or update ratings in the database
            await this.saveRatings(contentType, contentId, scrapedRatings);

            return true;
        } catch (error) {
            logger.error(`Error enriching ratings for ${contentType} ${contentId}:`, error);
            return false;
        }
    }

    /**
     * Get external IDs for a content item
     * @param contentType 'movie' or 'tv'
     * @param contentId The ID of the content in our database
     * @returns Promise<ExternalId[]> Array of external IDs
     */
    private async getExternalIds(contentType: string, contentId: number): Promise<ExternalId[]> {
        return await this.db('external_ids')
            .where({
                content_type: contentType,
                content_id: contentId,
            })
            .select('*');
    }

    /**
     * Get existing ratings for a content item
     * @param contentType 'movie' or 'tv'
     * @param contentId The ID of the content in our database
     * @returns Promise<RatingRecord[]> Array of existing ratings
     */
    private async getExistingRatings(contentType: string, contentId: number): Promise<RatingRecord[]> {
        return await this.db('ratings')
            .where({
                content_type: contentType,
                content_id: contentId,
            })
            .select('*');
    }

    /**
     * Save scraped ratings to the database
     * @param contentType 'movie' or 'tv'
     * @param contentId The ID of the content in our database
     * @param scrapedRatings The ratings data from the scraper
     * @returns Promise<void>
     */
    private async saveRatings(contentType: string, contentId: number, scrapedRatings: any): Promise<void> {
        const now = new Date();
        const ratingsToInsert: RatingRecord[] = [];

        // Process IMDb ratings
        if (scrapedRatings.imdb && (scrapedRatings.imdb.rating !== null || scrapedRatings.imdb.ratingCount !== null)) {
            ratingsToInsert.push({
                content_type: contentType,
                content_id: contentId,
                source: 'imdb',
                rating: scrapedRatings.imdb.rating,
                rating_count: scrapedRatings.imdb.ratingCount,
                consensus: null,
                rating_type: 'main',
                details: {
                    source_url: scrapedRatings.imdb.sourceUrl,
                    error: scrapedRatings.imdb.error,
                },
                last_updated: now,
            });
        }

        // Process Rotten Tomatoes critic ratings
        if (scrapedRatings.rottenTomatoes?.critic) {
            const critic = scrapedRatings.rottenTomatoes.critic;
            if (critic.score !== null || critic.ratingCount !== null || critic.consensus) {
                ratingsToInsert.push({
                    content_type: contentType,
                    content_id: contentId,
                    source: 'rottentomatoes',
                    rating: critic.score,
                    rating_count: critic.ratingCount,
                    consensus: critic.consensus || null,
                    rating_type: 'critic',
                    details: {
                        certified: critic.certified,
                        sentiment: critic.sentiment,
                        source_url: scrapedRatings.rottenTomatoes.sourceUrl,
                        error: scrapedRatings.rottenTomatoes.error,
                    },
                    last_updated: now,
                });
            }
        }

        // Process Rotten Tomatoes audience ratings
        if (scrapedRatings.rottenTomatoes?.audience) {
            const audience = scrapedRatings.rottenTomatoes.audience;
            if (audience.score !== null || audience.ratingCount !== null) {
                ratingsToInsert.push({
                    content_type: contentType,
                    content_id: contentId,
                    source: 'rottentomatoes',
                    rating: audience.score,
                    rating_count: audience.ratingCount,
                    consensus: null,
                    rating_type: 'audience',
                    details: {
                        certified: audience.certified,
                        sentiment: audience.sentiment,
                        source_url: scrapedRatings.rottenTomatoes.sourceUrl,
                        error: scrapedRatings.rottenTomatoes.error,
                    },
                    last_updated: now,
                });
            }
        }

        // Insert or update ratings
        for (const rating of ratingsToInsert) {
            await this.db('ratings')
                .where({
                    content_type: rating.content_type,
                    content_id: rating.content_id,
                    source: rating.source,
                    rating_type: rating.rating_type,
                })
                .then(async existing => {
                    if (existing.length > 0) {
                        // Update existing rating
                        await this.db('ratings')
                            .where({
                                content_type: rating.content_type,
                                content_id: rating.content_id,
                                source: rating.source,
                                rating_type: rating.rating_type,
                            })
                            .update({
                                rating: rating.rating,
                                rating_count: rating.rating_count,
                                consensus: rating.consensus,
                                details: rating.details,
                                last_updated: rating.last_updated,
                                updated_at: now,
                            });
                    } else {
                        // Insert new rating
                        await this.db('ratings').insert({
                            ...rating,
                            created_at: now,
                            updated_at: now,
                        });
                    }
                });
        }
    }

    /**
     * Process multiple content items in batch
     * @param contentType 'movie' or 'tv'
     * @param contentIds Array of content IDs
     * @param batchSize Number of items to process in parallel
     * @returns Promise<{success: number, failed: number}> Count of successful and failed enrichments
     */
    async processBatch(
        contentType: string,
        contentIds: number[],
        batchSize: number = 5
    ): Promise<{ success: number; failed: number }> {
        const results = { success: 0, failed: 0 };

        // Process in batches to avoid overwhelming the system
        for (let i = 0; i < contentIds.length; i += batchSize) {
            const batch = contentIds.slice(i, i + batchSize);
            const batchPromises = batch.map(id => this.enrichContent(contentType, id));

            const batchResults = await Promise.allSettled(batchPromises);

            batchResults.forEach(result => {
                if (result.status === 'fulfilled' && result.value) {
                    results.success++;
                } else {
                    results.failed++;
                }
            });

            // Add a small delay between batches to avoid rate limiting
            if (i + batchSize < contentIds.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        return results;
    }
}
