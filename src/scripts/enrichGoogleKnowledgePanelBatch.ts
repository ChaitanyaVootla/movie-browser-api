import { GoogleKnowledgePanelEnricher } from '../services/enrichment/googleKnowledgePanelEnricher';
import { logger } from '../utils/logger';
// Import knexfile with require to avoid TypeScript errors
const knexConfig = require('../../knexfile');

// Initialize Knex with the development configuration
const knex = require('knex')(knexConfig.development);

async function enrichBatch() {
    try {
        // Get command line arguments
        const args = process.argv.slice(2);
        const contentType = args[0]?.toLowerCase();
        const countryCode = args[1]?.toUpperCase() || 'US';
        const batchSize = args[2] ? parseInt(args[2], 10) : 5;

        if (!contentType) {
            console.error(
                'Usage: npx ts-node src/scripts/enrichGoogleKnowledgePanelBatch.ts <contentType> [countryCode] [batchSize]'
            );
            console.error('Example: npx ts-node src/scripts/enrichGoogleKnowledgePanelBatch.ts movie US 5');
            process.exit(1);
        }

        if (contentType !== 'movie' && contentType !== 'tv') {
            console.error('Content type must be either "movie" or "tv"');
            process.exit(1);
        }

        logger.info(
            `Starting batch enrichment for ${contentType}s with country ${countryCode} and batch size ${batchSize}`
        );

        // Get all content IDs
        const contents = await knex(contentType === 'movie' ? 'movies' : 'tv_series')
            .select('id')
            .orderBy('id');

        logger.info(`Found ${contents.length} ${contentType}s to process`);

        // Process in batches
        const contentIds = contents.map((c: { id: number }) => c.id);
        const enricher = new GoogleKnowledgePanelEnricher(knex);
        const results = await enricher.processBatch(contentType, contentIds, batchSize, countryCode);

        logger.info(`Processed ${results.success} ${contentType}s successfully, ${results.failed} failed`);
    } catch (error) {
        logger.error('Error during batch enrichment:', error);
    } finally {
        await knex.destroy();
    }
}

// Run the batch enrichment
enrichBatch().catch(error => {
    logger.error('Unhandled error:', error);
    process.exit(1);
});
