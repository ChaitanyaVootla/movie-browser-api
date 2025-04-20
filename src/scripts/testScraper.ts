import { scrapeRatings } from '@services/scraping/ratingsScraper';
import logger from '@utils/logger';
import { Knex } from 'knex';
const knexConfig = require('../../knexfile');
const knex = require('knex')(knexConfig.development);

async function getExternalIds(db: Knex, tmdbId: number): Promise<{
  imdbId: string | null;
  rottenTomatoesId: string | null;
}> {
  try {
    // First, get our internal movie ID from the TMDB ID
    const movie = await db('movies').where('tmdb_id', tmdbId).first();
    
    if (!movie) {
      logger.error(`Movie with TMDB ID ${tmdbId} not found in database`);
      return { imdbId: null, rottenTomatoesId: null };
    }
    
    // Get external IDs for this movie
    const externalIds = await db('external_ids')
      .where({
        content_type: 'movie',
        content_id: movie.id
      })
      .select('source', 'external_id');
    
    // Extract IMDb and Rotten Tomatoes IDs
    const imdbId = externalIds.find(id => id.source === 'imdb')?.external_id || null;
    const rottenTomatoesId = externalIds.find(id => id.source === 'rottentomatoes')?.external_id || null;
    
    return { imdbId, rottenTomatoesId };
  } catch (error) {
    logger.error('Error fetching external IDs:', error);
    return { imdbId: null, rottenTomatoesId: null };
  }
}

async function testScraperWithTmdbId() {
  try {
    // Get TMDB ID from command line arguments, default to Shawshank Redemption if not provided
    const args = process.argv.slice(2);
    const tmdbId = args.length > 0 ? parseInt(args[0], 10) : 278; // Default: Shawshank Redemption
    
    if (isNaN(tmdbId)) {
      logger.error('Invalid TMDB ID. Please provide a valid number.');
      process.exit(1);
    }
    
    logger.info(`Testing scraper with TMDB ID: ${tmdbId}`);
    
    // Get external IDs from database
    const { imdbId, rottenTomatoesId } = await getExternalIds(knex, tmdbId);
    
    // Build URLs
    let rtUrl = null;
    if (rottenTomatoesId) {
      rtUrl = `https://www.rottentomatoes.com/${rottenTomatoesId}`;
    }
    
    // If we don't have either ID, we can't proceed
    if (!imdbId && !rtUrl) {
      logger.error(`No IMDb ID or Rotten Tomatoes ID found for TMDB ID: ${tmdbId}`);
      process.exit(1);
    }
    
    logger.info(`Using IMDb ID: ${imdbId || 'Not found'}`);
    logger.info(`Using Rotten Tomatoes URL: ${rtUrl || 'Not found'}`);
    
    // Call scrapeRatings directly
    const results = await scrapeRatings(imdbId, rtUrl);
    
    logger.info('Scraping results:');
    logger.info(JSON.stringify(results, null, 2));
  } catch (error) {
    logger.error('Error testing scraper:', error);
    process.exit(1);
  } finally {
    // Close the database connection
    await knex.destroy();
  }
}

// Run the test
testScraperWithTmdbId();
