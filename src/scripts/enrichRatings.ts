import { Knex } from 'knex';
import { RatingsEnricher } from '@services/enrichment/ratingsEnricher';
import logger from '@utils/logger';
// Import knexfile with require to avoid TypeScript errors
const knexConfig = require('../../knexfile');

// Initialize Knex with the development configuration
const knex = require('knex')(knexConfig.development);

/**
 * Main function to enrich ratings for movies and TV shows
 */
async function main() {
    try {
        logger.info('Starting ratings enrichment process');

        // Initialize the ratings enricher
        const ratingsEnricher = new RatingsEnricher(knex);

        // Get all movies with external IDs
        const moviesWithExternalIds = await knex('movies')
            .select('movies.id')
            .join('external_ids', 'movies.id', '=', 'external_ids.content_id')
            .where('external_ids.content_type', '=', 'movie')
            .distinct();

        logger.info(`Found ${moviesWithExternalIds.length} movies with external IDs`);

        // Process movies in batches
        const movieIds = moviesWithExternalIds.map((m: { id: number }) => m.id);
        const movieResults = await ratingsEnricher.processBatch('movie', movieIds, 5);

        logger.info(`Processed ${movieResults.success} movies successfully, ${movieResults.failed} failed`);

        // Get all TV shows with external IDs
        const tvShowsWithExternalIds = await knex('tv_series')
            .select('tv_series.id')
            .join('external_ids', 'tv_series.id', '=', 'external_ids.content_id')
            .where('external_ids.content_type', '=', 'tv')
            .distinct();

        logger.info(`Found ${tvShowsWithExternalIds.length} TV shows with external IDs`);

        // Process TV shows in batches
        const tvIds = tvShowsWithExternalIds.map((t: { id: number }) => t.id);
        const tvResults = await ratingsEnricher.processBatch('tv', tvIds, 5);

        logger.info(`Processed ${tvResults.success} TV shows successfully, ${tvResults.failed} failed`);

        logger.info('Ratings enrichment process completed');
    } catch (error) {
        logger.error('Error during ratings enrichment process:', error);
    } finally {
        // Close the database connection
        await knex.destroy();
    }
}

// Run the main function
main().catch(error => {
    logger.error('Unhandled error in main function:', error);
    process.exit(1);
});
