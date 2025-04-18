import { RatingsEnricher } from '@services/enrichment/ratingsEnricher';
import { GoogleKnowledgePanelEnricher } from '@services/enrichment/googleKnowledgePanelEnricher';
import { WikidataEnricher } from '@services/enrichment/wikidataEnricher';
import logger from '@utils/logger';
// Import knexfile with require to avoid TypeScript errors
const knexConfig = require('../../knexfile');

// Initialize Knex with the development configuration
const knex = require('knex')(knexConfig.development);

interface ExternalId {
    external_id: string;
}

/**
 * Enrich ratings and Google data for a specific content item
 * @param contentType 'movie' or 'tv'
 * @param tmdbId The TMDB ID of the content
 * @param countryCode The country code for Google data (e.g., 'US', 'UK')
 */
async function enrichSingleContent(contentType: string, tmdbId: number, countryCode: string = 'US') {
    try {
        logger.info(`Starting enrichment for ${contentType} with TMDB ID ${tmdbId}`);

        // Initialize the enrichers
        const ratingsEnricher = new RatingsEnricher(knex);
        const wikidataEnricher = new WikidataEnricher(knex);
        const googleEnricher = new GoogleKnowledgePanelEnricher(knex);

        // Check if the content exists and get our database ID
        const content = await knex(contentType === 'movie' ? 'movies' : 'tv_series')
            .where('tmdb_id', tmdbId)
            .first();

        if (!content) {
            logger.error(`${contentType} with TMDB ID ${tmdbId} not found`);
            return;
        }

        // Enrich ratings
        const ratingsSuccess = await ratingsEnricher.enrichContent(contentType, content.id);
        if (ratingsSuccess) {
            logger.info(`Successfully enriched ratings for ${contentType} with TMDB ID ${tmdbId}`);
        } else {
            logger.warn(`Failed to enrich ratings for ${contentType} with TMDB ID ${tmdbId}`);
        }

        // Get Wikidata ID from external_ids
        const wikidataId = await knex('external_ids')
            .where({
                content_type: contentType,
                content_id: content.id,
                source: 'wikidata'
            })
            .first()
            .then((record: ExternalId | undefined) => record?.external_id);

        // Enrich Wikidata external IDs if we have a Wikidata ID
        if (wikidataId) {
            const wikidataSuccess = await wikidataEnricher.enrichContent(contentType, content.id, wikidataId);
            if (wikidataSuccess) {
                logger.info(`Successfully enriched Wikidata external IDs for ${contentType} with TMDB ID ${tmdbId}`);
            } else {
                logger.warn(`No new external IDs found from Wikidata for ${contentType} with TMDB ID ${tmdbId}`);
            }
        } else {
            logger.warn(`No Wikidata ID found for ${contentType} with TMDB ID ${tmdbId}, skipping Wikidata enrichment`);
        }

        // Enrich Google data using Lambda
        const googleSuccess = await googleEnricher.processPriorityCountries(contentType, content.id);
        if (googleSuccess) {
            logger.info(`Successfully enriched Google data for ${contentType} with TMDB ID ${tmdbId}`);
        } else {
            logger.warn(`Failed to enrich Google data for ${contentType} with TMDB ID ${tmdbId}`);
        }
    } catch (error) {
        logger.error({ err: error }, `Error enriching ${contentType} with TMDB ID ${tmdbId}`);
    } finally {
        // Close the database connection
        await knex.destroy();
    }
}

// Check command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('Usage: npx ts-node src/scripts/enrichSingleContent.ts <contentType> <tmdbId> [countryCode]');
    console.error('Example: npx ts-node src/scripts/enrichSingleContent.ts movie 550 US'); // Example using Fight Club's TMDB ID
    process.exit(1);
}

const contentType = args[0].toLowerCase();
const tmdbId = parseInt(args[1], 10);
const countryCode = args[2]?.toUpperCase() || 'US';

if (contentType !== 'movie' && contentType !== 'tv') {
    console.error('Content type must be either "movie" or "tv"');
    process.exit(1);
}

if (isNaN(tmdbId)) {
    console.error('TMDB ID must be a number');
    process.exit(1);
}

// Run the enrichment
enrichSingleContent(contentType, tmdbId, countryCode).catch(error => {
    logger.error({ err: error }, 'Unhandled error');
    process.exit(1);
});
