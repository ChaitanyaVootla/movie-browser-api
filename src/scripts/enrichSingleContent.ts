import { Knex } from 'knex';
import { RatingsEnricher } from '../services/enrichment/ratingsEnricher';
import { GoogleKnowledgePanelEnricherLambda } from '../services/enrichment/googleKnowledgePanelEnricherLambda';
import { logger } from '../utils/logger';
// Import knexfile with require to avoid TypeScript errors
const knexConfig = require('../../knexfile');

// Initialize Knex with the development configuration
const knex = require('knex')(knexConfig.development);

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
        const googleEnricher = new GoogleKnowledgePanelEnricherLambda(knex);

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

        // Enrich Google data using Lambda
        const googleSuccess = await googleEnricher.enrichContent(contentType, content.id, countryCode);
        if (googleSuccess) {
            logger.info(`Successfully enriched Google data for ${contentType} with TMDB ID ${tmdbId}`);
        } else {
            logger.warn(`Failed to enrich Google data for ${contentType} with TMDB ID ${tmdbId}`);
        }
    } catch (error) {
        logger.error(`Error enriching ${contentType} with TMDB ID ${tmdbId}:`, error);
    } finally {
        // Close the database connection
        await knex.destroy();
    }
}

// Check command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('Usage: node enrichSingleContent.js <contentType> <tmdbId> [countryCode]');
    console.error('Example: node enrichSingleContent.js movie 550 US'); // Example using Fight Club's TMDB ID
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
    logger.error('Unhandled error:', error);
    process.exit(1);
});
