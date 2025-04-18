import { handler } from '@services/scraping/ratingsScraper';
import logger from '@utils/logger';

// Sample test data
const testEvent = {
    body: JSON.stringify({
        imdbId: 'tt0111161', // The Shawshank Redemption
        rottenTomatoesUrl: 'https://www.rottentomatoes.com/m/avengers_age_of_ultron',
    }),
    headers: {
        'Content-Type': 'application/json',
    },
    httpMethod: 'POST',
    path: '/scrape',
    queryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {},
    resource: '/scrape',
};

async function testLocalScraper() {
    try {
        logger.info('Testing scraper with event:', JSON.stringify(testEvent, null, 2));
        const result = await handler(testEvent as any);
        logger.info(result.body, 'Scraping result');
    } catch (error) {
        logger.error('Error testing scraper:', error);
    }
}

// Run the test
testLocalScraper();
