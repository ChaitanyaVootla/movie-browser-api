import { Knex } from 'knex';
import { fetchWikidataExternalIds } from '@services/scraping/wikidataScraper';
import logger from '@utils/logger';

const SOURCE_MAP: Record<string, string> = {
    imdb_id: 'imdb',
    tmdb_id: 'tmdb',
    rottentomatoes_id: 'rottentomatoes',
    metacritic_id: 'metacritic',
    letterboxd_id: 'letterboxd',
    netflix_id: 'netflix',
    prime_id: 'prime',
    apple_id: 'apple',
    hotstar_id: 'hotstar',
};

export class WikidataEnricher {
    constructor(private readonly db: Knex) {}

    /**
     * Enrich a single content item with external IDs from Wikidata
     * @param contentType 'movie' or 'tv'
     * @param contentId Our DB ID
     * @param wikidataId Wikidata Q-ID (e.g., Q12345)
     */
    async enrichContent(contentType: string, contentId: number, wikidataId: string): Promise<boolean> {
        try {
            logger.info(`Fetching Wikidata external IDs for ${contentType} ${contentId} (wikidata: ${wikidataId})`);
            const ids = await fetchWikidataExternalIds(wikidataId);
            let updated = false;
            for (const [key, value] of Object.entries(ids)) {
                if (!value) continue;
                const source = SOURCE_MAP[key];
                if (!source) continue;
                // Upsert into external_ids
                const existing = await this.db('external_ids')
                    .where({ content_type: contentType, content_id: contentId, source })
                    .first();
                if (existing) {
                    await this.db('external_ids')
                        .where({ content_type: contentType, content_id: contentId, source })
                        .update({
                            external_id: value,
                            confidence_score: 0.95,
                            last_verified: new Date(),
                            updated_at: new Date(),
                        });
                    logger.info(`Updated external_id: ${source}=${value} for ${contentType} ${contentId}`);
                } else {
                    await this.db('external_ids').insert({
                        content_type: contentType,
                        content_id: contentId,
                        source,
                        external_id: value,
                        confidence_score: 0.95,
                        last_verified: new Date(),
                        created_at: new Date(),
                        updated_at: new Date(),
                    });
                    logger.info(`Inserted external_id: ${source}=${value} for ${contentType} ${contentId}`);
                }
                updated = true;
            }
            return updated;
        } catch (error) {
            logger.error(`Error enriching Wikidata external IDs for ${contentType} ${contentId}:`, error);
            return false;
        }
    }
} 