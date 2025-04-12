import { GoogleKnowledgePanelEnricher } from '../services/enrichment/googleKnowledgePanelEnricher';
import { logger } from '../utils/logger';
// Import knexfile with require to avoid TypeScript errors
const knexConfig = require('../../knexfile');

// Initialize Knex with the development configuration
const knex = require('knex')(knexConfig.development);

async function enrichContent() {
    try {
        // Get command line arguments
        const args = process.argv.slice(2);
        const contentType = args[0]?.toLowerCase();
        const contentId = parseInt(args[1], 10);
        const countryCode = args[2]?.toUpperCase() || 'US';

        if (!contentType || !contentId || isNaN(contentId)) {
            console.error(
                'Usage: npx ts-node src/scripts/enrichGoogleKnowledgePanel.ts <contentType> <contentId> [countryCode]'
            );
            console.error('Example: npx ts-node src/scripts/enrichGoogleKnowledgePanel.ts movie 550 US');
            process.exit(1);
        }

        if (contentType !== 'movie' && contentType !== 'tv') {
            console.error('Content type must be either "movie" or "tv"');
            process.exit(1);
        }

        logger.info(`Enriching ${contentType} with ID ${contentId} for country ${countryCode}`);

        const enricher = new GoogleKnowledgePanelEnricher(knex);
        const success = await enricher.enrichContent(contentType, contentId, countryCode);

        if (success) {
            logger.info(`Successfully enriched ${contentType} with ID ${contentId}`);
        } else {
            logger.error(`Failed to enrich ${contentType} with ID ${contentId}`);
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
