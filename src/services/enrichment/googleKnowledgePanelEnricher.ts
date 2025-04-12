import { Knex } from 'knex';
import { logger } from '../../utils/logger';
import { GoogleKnowledgePanelScraper, GoogleSearchResult } from '../scraping/googleKnowledgePanelScraper';

export class GoogleKnowledgePanelEnricher {
    private knex: Knex;
    private scraper: GoogleKnowledgePanelScraper;

    constructor(knex: Knex) {
        this.knex = knex;
        this.scraper = new GoogleKnowledgePanelScraper();
    }

    async enrichContent(contentType: string, contentId: number, countryCode: string = 'US'): Promise<boolean> {
        try {
            // Get content details
            const content = await this.knex(contentType === 'movie' ? 'movies' : 'tv_series')
                .where('id', contentId)
                .first();

            if (!content) {
                logger.error(`${contentType} with ID ${contentId} not found`);
                return false;
            }

            // Create search string
            const searchString = `${content.title || content.name} ${contentType === 'movie' ? 'movie' : 'tv show'}`;

            // Initialize scraper and scrape Google knowledge panel
            await this.scraper.initialize();
            const result = await this.scraper.scrape(searchString, countryCode);

            try {
                // Save ratings
                for (const rating of result.ratings) {
                    if (rating.name.toLowerCase() === 'google') {
                        // Convert Google percentage to decimal
                        const ratingValue = parseFloat(rating.rating) / 100;
                        await this.knex('ratings')
                            .insert({
                                content_type: contentType,
                                content_id: contentId,
                                source: 'google',
                                rating: ratingValue,
                                last_updated: new Date(),
                            })
                            .onConflict(['content_type', 'content_id', 'source'])
                            .merge();
                    }
                }

                // Save watch options
                for (const option of result.allWatchOptions) {
                    // Extract provider name from URL or use provided name
                    const providerName = option.name.toLowerCase();

                    // Find or create provider
                    const provider = await this.knex('watch_providers')
                        .where('name', 'ilike', `%${providerName}%`)
                        .first();

                    if (provider) {
                        await this.knex('watch_links')
                            .insert({
                                content_type: contentType,
                                content_id: contentId,
                                provider_id: provider.id,
                                country_code: countryCode,
                                link_type: option.price ? 'rent' : 'stream',
                                url: option.link,
                                price: option.price ? parseFloat(option.price.replace(/[^0-9.]/g, '')) : null,
                                currency: 'USD',
                                last_verified: new Date(),
                            })
                            .onConflict(['content_type', 'content_id', 'provider_id', 'country_code', 'link_type'])
                            .merge();
                    }
                }

                return true;
            } finally {
                await this.scraper.close();
            }
        } catch (error) {
            logger.error(`Error enriching ${contentType} ${contentId}:`, error);
            return false;
        }
    }

    async processBatch(
        contentType: string,
        contentIds: number[],
        batchSize: number = 5,
        countryCode: string = 'US'
    ): Promise<{ success: number; failed: number }> {
        const results = { success: 0, failed: 0 };

        for (let i = 0; i < contentIds.length; i += batchSize) {
            const batch = contentIds.slice(i, i + batchSize);
            logger.info(`Processing batch ${i / batchSize + 1} of ${Math.ceil(contentIds.length / batchSize)}`);

            for (const contentId of batch) {
                try {
                    const success = await this.enrichContent(contentType, contentId, countryCode);
                    if (success) {
                        results.success++;
                    } else {
                        results.failed++;
                    }
                } catch (error) {
                    logger.error(`Error processing ${contentType} ${contentId}:`, error);
                    results.failed++;
                }
            }
        }

        return results;
    }
}
