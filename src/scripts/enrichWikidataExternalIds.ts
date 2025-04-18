import { Knex } from 'knex';
import { WikidataEnricher } from '@services/enrichment/wikidataEnricher';
import logger from '@utils/logger';
const knexConfig = require('../../knexfile');
const knex = require('knex')(knexConfig.development);

async function enrichWikidataExternalIds(contentType: string, tmdbId: number, wikidataId?: string) {
    try {
        logger.info(`Starting Wikidata enrichment for ${contentType} with TMDB ID ${tmdbId}`);
        const table = contentType === 'movie' ? 'movies' : 'tv_series';
        const content = await knex(table).where('tmdb_id', tmdbId).first();
        if (!content) {
            logger.error(`${contentType} with TMDB ID ${tmdbId} not found`);
            process.exit(1);
        }
        let wdId: string | undefined = wikidataId;
        if (!wdId) {
            // Try to get from external_ids
            const existing = await knex('external_ids')
                .where({ content_type: contentType, content_id: content.id, source: 'wikidata' })
                .first();
            if (existing && existing.external_id) {
                wdId = existing.external_id;
                logger.info(`Found Wikidata ID from external_ids: ${wdId}`);
            } else {
                logger.error(`No Wikidata ID found in external_ids for ${contentType} with TMDB ID ${tmdbId}. Please provide a Wikidata ID.`);
                process.exit(1);
            }
        }
        if (typeof wdId !== 'string' || !wdId) {
            logger.error('Wikidata ID is required and must be a string.');
            process.exit(1);
        }
        const enricher = new WikidataEnricher(knex);
        const success = await enricher.enrichContent(contentType, content.id, wdId);
        if (success) {
            logger.info(`Successfully enriched Wikidata external IDs for ${contentType} with TMDB ID ${tmdbId}`);
        } else {
            logger.warn(`No new external IDs found or updated for ${contentType} with TMDB ID ${tmdbId}`);
        }
    } catch (error) {
        logger.error(`Error enriching Wikidata external IDs:`, error);
        process.exit(1);
    } finally {
        await knex.destroy();
    }
}

// CLI usage: node enrichWikidataExternalIds.js <contentType> <tmdbId> [wikidataId]
const args = process.argv.slice(2);
if (args.length < 2) {
    logger.error('Usage: node enrichWikidataExternalIds.js <contentType> <tmdbId> [wikidataId]');
    process.exit(1);
}
const contentType = args[0].toLowerCase();
const tmdbId = parseInt(args[1], 10);
const wikidataId: string | undefined = args[2];
if (contentType !== 'movie' && contentType !== 'tv') {
    logger.error('Content type must be either "movie" or "tv"');
    process.exit(1);
}
if (isNaN(tmdbId)) {
    logger.error('TMDB ID must be a number');
    process.exit(1);
}
enrichWikidataExternalIds(contentType, tmdbId, wikidataId).catch(error => {
    logger.error('Unhandled error:', error);
    process.exit(1);
}); 