import { Knex } from 'knex';
import * as path from 'path';
import logger from '@utils/logger';
import { 
  fetchAllMovieExternalIds, 
  readMovieExternalIds, 
  EXTERNAL_ID_SOURCE_MAP, 
  EXTERNAL_ID_CONFIDENCE,
  WikidataMovieIds 
} from '@utils/wikidataBatchUtils';

const knexConfig = require('../../knexfile');
const knex = require('knex')(knexConfig.development);

/**
 * Import external IDs for a movie from Wikidata into our database
 */
async function importMovieExternalIds(
  db: Knex,
  movieData: WikidataMovieIds,
  options: {
    skipExisting: boolean;
    batchSize: number;
    dryRun: boolean;
  }
): Promise<boolean> {
  try {
    // First, we need to find our internal movie by TMDB ID or IMDb ID
    if (!movieData.tmdbId && !movieData.imdbId) {
      logger.debug(`Skipping ${movieData.movieLabel} - no TMDB or IMDb ID`);
      return false;
    }

    let movie;
    if (movieData.tmdbId) {
      movie = await db('movies').where('tmdb_id', movieData.tmdbId).first();
    }

    if (!movie && movieData.imdbId) {
      movie = await db('movies').where('imdb_id', movieData.imdbId).first();
    }

    if (!movie) {
      logger.debug(`Movie not found in database: ${movieData.movieLabel}`);
      return false;
    }

    const externalIds: Array<{
      content_type: string;
      content_id: number;
      source: string;
      external_id: string;
      confidence_score: number;
      last_verified: Date;
      created_at: Date;
      updated_at: Date;
    }> = [];

    // Store Wikidata ID as well
    externalIds.push({
      content_type: 'movie',
      content_id: movie.id,
      source: 'wikidata',
      external_id: movieData.movie,
      confidence_score: EXTERNAL_ID_CONFIDENCE.wikidata,
      last_verified: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Process each external ID from Wikidata
    for (const [key, value] of Object.entries(EXTERNAL_ID_SOURCE_MAP)) {
      const wikidataKey = key as keyof WikidataMovieIds;
      const externalId = movieData[wikidataKey];
      
      if (externalId) {
        externalIds.push({
          content_type: 'movie',
          content_id: movie.id,
          source: value,
          external_id: externalId,
          confidence_score: EXTERNAL_ID_CONFIDENCE[value] || 0.90, // Default to 0.90 if not specified
          last_verified: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
    }

    if (externalIds.length === 0) {
      logger.debug(`No external IDs found for movie: ${movieData.movieLabel}`);
      return false;
    }

    if (options.dryRun) {
      logger.info(`[DRY RUN] Would import ${externalIds.length} external IDs for ${movieData.movieLabel}`);
      return true;
    }

    // Insert external IDs
    for (const externalId of externalIds) {
      if (options.skipExisting) {
        // Check if this external ID already exists
        const existing = await db('external_ids')
          .where({
            content_type: externalId.content_type,
            content_id: externalId.content_id,
            source: externalId.source,
          })
          .first();

        if (existing) {
          // Update only if confidence score is equal or higher and the ID is different
          if (externalId.confidence_score >= existing.confidence_score && existing.external_id !== externalId.external_id) {
            await db('external_ids')
              .where({
                content_type: externalId.content_type,
                content_id: externalId.content_id,
                source: externalId.source,
              })
              .update({
                external_id: externalId.external_id,
                confidence_score: externalId.confidence_score,
                last_verified: externalId.last_verified,
                updated_at: externalId.updated_at
              });
            logger.debug(`Updated external ID ${externalId.source} for ${movieData.movieLabel} (confidence: ${existing.confidence_score} -> ${externalId.confidence_score})`);
          } else {
            logger.debug(`Skipped update for ${externalId.source} - existing confidence score (${existing.confidence_score}) >= new confidence (${externalId.confidence_score}) or ID unchanged`);
          }
          continue;
        }
      }

      // Insert new external ID
      try {
        await db('external_ids').insert(externalId);
        logger.debug(`Inserted external ID ${externalId.source} for ${movieData.movieLabel}`);
      } catch (error) {
        // If the error is a duplicate key violation, ignore it
        if ((error as any).code === '23505') { // PostgreSQL unique violation
          logger.debug(`External ID ${externalId.source} already exists for ${movieData.movieLabel}`);
        } else {
          throw error;
        }
      }
    }

    return true;
  } catch (error) {
    logger.error(`Error importing external IDs for ${movieData.movieLabel}:`, error);
    return false;
  }
}

/**
 * Main function to run the Wikidata external IDs import
 */
async function importWikidataExternalIds(options: {
  outputPath?: string;
  limit?: number;
  skipFetch?: boolean;
  skipExisting?: boolean;
  batchSize?: number;
  dryRun?: boolean;
}) {
  try {
    const outputPath = options.outputPath || path.join(process.cwd(), 'data', 'wikidata', `movies-${new Date().toISOString().split('T')[0]}.json`);
    let filePath = outputPath;

    if (!options.skipFetch) {
      filePath = await fetchAllMovieExternalIds(outputPath, options.limit);
    }

    const movieIds = readMovieExternalIds(filePath);
    logger.info(`Processing ${movieIds.length} movies from ${filePath}`);

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    // Process in batches for better performance and to avoid memory issues
    const batchSize = options.batchSize || 100;
    for (let i = 0; i < movieIds.length; i += batchSize) {
      const batch = movieIds.slice(i, i + batchSize);
      logger.info(`Processing batch ${i / batchSize + 1} of ${Math.ceil(movieIds.length / batchSize)} (${batch.length} movies)`);
      
      for (const movieData of batch) {
        const success = await importMovieExternalIds(knex, movieData, {
          skipExisting: options.skipExisting || false,
          batchSize: options.batchSize || 100,
          dryRun: options.dryRun || false
        });
        
        if (success) {
          successCount++;
        } else {
          skippedCount++;
        }
      }
      
      logger.info(`Batch complete. Progress: ${i + batch.length}/${movieIds.length} movies processed`);
    }

    logger.info(`
Import completed:
- Total movies processed: ${movieIds.length}
- Successfully imported: ${successCount}
- Errors: ${errorCount}
- Skipped: ${skippedCount}
    `);
  } catch (error) {
    logger.error('Error importing Wikidata external IDs:', error);
    process.exit(1);
  } finally {
    await knex.destroy();
  }
}

// Parse command-line arguments
const args = process.argv.slice(2);
const options: {
  outputPath?: string;
  limit?: number;
  skipFetch?: boolean;
  skipExisting?: boolean;
  batchSize?: number;
  dryRun?: boolean;
} = {
  skipExisting: true,
  batchSize: 100,
  dryRun: false
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--output' && args[i + 1]) {
    options.outputPath = args[++i];
  } else if (arg === '--limit' && args[i + 1]) {
    options.limit = parseInt(args[++i], 10);
  } else if (arg === '--skip-fetch') {
    options.skipFetch = true;
  } else if (arg === '--force') {
    options.skipExisting = false;
  } else if (arg === '--batch-size' && args[i + 1]) {
    options.batchSize = parseInt(args[++i], 10);
  } else if (arg === '--dry-run') {
    options.dryRun = true;
  } else if (arg === '--help') {
    console.log(`
Usage: npx ts-node src/scripts/importWikidataExternalIds.ts [options]

Options:
  --output PATH       Output path for the JSON file
  --limit NUMBER      Limit the number of movies to fetch from Wikidata
  --skip-fetch        Skip fetching from Wikidata (use existing file)
  --force             Force update existing external IDs
  --batch-size NUMBER Number of movies to process in each batch (default: 100)
  --dry-run           Run without making any changes to the database
  --help              Show this help message
    `);
    process.exit(0);
  }
}

// Run the import
importWikidataExternalIds(options).catch(error => {
  logger.error('Unhandled error:', error);
  process.exit(1);
}); 