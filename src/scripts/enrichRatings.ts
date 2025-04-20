import { RatingsEnricher } from '@services/enrichment/ratingsEnricher';
import logger from '@utils/logger';
// Import knexfile with require to avoid TypeScript errors
const knexConfig = require('../../knexfile');

// Initialize Knex with the development configuration
const knex = require('knex')(knexConfig.development);

/**
 * Main function to enrich ratings for movies and TV shows that have external IDs
 * for IMDB or Rotten Tomatoes but no corresponding ratings
 */
async function main() {
    try {
        logger.info('Starting ratings enrichment process for missing ratings');

        // Initialize the ratings enricher
        const ratingsEnricher = new RatingsEnricher(knex);

        // Define the rating sources we're targeting
        const targetSources = ['imdb', 'rottentomatoes'];

        // Get all movies with IMDB or Rotten Tomatoes external IDs but no ratings
        const moviesNeedingRatings = await knex('movies')
            .select('movies.id')
            // Use an object to define the join condition
            .join('external_ids', {
                'movies.id': 'external_ids.content_id'
            })
            // Add the content_type condition with raw SQL
            .whereRaw('external_ids.content_type = ?', ['movie'])
            .whereIn('external_ids.source', targetSources)
            .whereNotExists(
                knex.select('*')
                    .from('ratings')
                    .whereRaw('ratings.content_id = movies.id')
                    .andWhere('ratings.content_type', '=', 'movie')
                    .whereIn('ratings.source', targetSources)
            )
            .distinct();

        logger.info(`Found ${moviesNeedingRatings.length} movies with external IDs but missing ratings`);

        // Process movies in batches
        const movieIds = moviesNeedingRatings.map((m: { id: number }) => m.id);
        const movieResults = await ratingsEnricher.processBatch('movie', movieIds, 50);

        logger.info(`Processed ${movieResults.success} movies successfully, ${movieResults.failed} failed`);
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
