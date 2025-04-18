import { GoogleKnowledgePanelEnricher } from '@services/enrichment/googleKnowledgePanelEnricher';
import logger from '@utils/logger';
// Import knexfile with require to avoid TypeScript errors
const knexConfig = require('../../knexfile');

// Initialize Knex with the development configuration
const knex = require('knex')(knexConfig.development);

async function enrichContent() {
    try {
        // Get command line arguments
        const args = process.argv.slice(2);
        const contentType = args[0]?.toLowerCase();
        const tmdbId = parseInt(args[1], 10);
        const countryCode = args[2]?.toUpperCase() || 'US';

        if (!contentType || !tmdbId || isNaN(tmdbId)) {
            logger.error(
                'Usage: npx ts-node src/scripts/enrichGoogleKnowledgePanel.ts <contentType> <tmdbId> [countryCode]'
            );
            logger.error('Example: npx ts-node src/scripts/enrichGoogleKnowledgePanel.ts movie 550 US');
            process.exit(1);
        }

        if (contentType !== 'movie' && contentType !== 'tv') {
            logger.error('Content type must be either "movie" or "tv"');
            process.exit(1);
        }

        logger.info(`Looking up ${contentType} with TMDB ID ${tmdbId}`);

        // Find the content by TMDB ID
        const tableName = contentType === 'movie' ? 'movies' : 'tv_series';
        const content = await knex(tableName).where('tmdb_id', tmdbId).first();

        if (!content) {
            logger.error(`${contentType} with TMDB ID ${tmdbId} not found in database`);
            process.exit(1);
        }

        const contentId = content.id;
        logger.info(`Found ${contentType} with internal ID ${contentId}, enriching for country ${countryCode}`);

        const enricher = new GoogleKnowledgePanelEnricher(knex);
        const success = await enricher.enrichContent(contentType, contentId, countryCode);

        if (success) {
            logger.info(`Successfully enriched ${contentType} with TMDB ID ${tmdbId} (internal ID: ${contentId})`);
        } else {
            logger.error(`Failed to enrich ${contentType} with TMDB ID ${tmdbId} (internal ID: ${contentId})`);
        }
    } catch (error) {
        logger.error('Error enriching content:', error);
    } finally {
        await knex.destroy();
    }
}

// Run the enrichment
enrichContent().catch(error => {
    logger.error('Unhandled error:', error);
    process.exit(1);
});
