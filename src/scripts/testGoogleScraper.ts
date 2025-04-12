import { handler } from '../services/scraping/googleKnowledgePanelScraper';

// Sample test data
const testEvent = {
    body: JSON.stringify({
        searchString: 'The Shawshank Redemption',
        countryCode: 'US',
    }),
    headers: {
        'Content-Type': 'application/json',
    },
    httpMethod: 'POST',
    path: '/scrape/google',
    queryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {},
    resource: '/scrape/google',
};

async function testLocalScraper() {
    try {
        console.log('Testing Google Knowledge Panel scraper with event:', JSON.stringify(testEvent, null, 2));
        const result = await handler(testEvent as any);
        console.log('Scraping result:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Error testing scraper:', error);
    }
}

// Run the test
testLocalScraper();
