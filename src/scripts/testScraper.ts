import { handler } from '../services/scraping/ratingsScraper';

// Sample test data
const testEvent = {
    body: JSON.stringify({
        imdbId: 'tt0111161', // The Shawshank Redemption
        rottenTomatoesUrl: 'https://www.rottentomatoes.com/m/shawshank_redemption',
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
        console.log('Testing scraper with event:', JSON.stringify(testEvent, null, 2));
        const result = await handler(testEvent as any);
        console.log('Scraping result:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Error testing scraper:', error);
    }
}

// Run the test
testLocalScraper();
