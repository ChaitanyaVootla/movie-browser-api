import { config } from 'dotenv';
import { TMDBService } from '@services/TMDBService';
import { MovieRepository } from '@repositories/movie.repository';
import { GenreRepository } from '@repositories/genre.repository';
import { ProductionCompanyRepository } from '@repositories/production-company.repository';
import db from '@config/database';
import { Knex } from 'knex'; // Import Knex type for transaction
import * as async from 'async'; // Import async library
// Import Zod schemas to infer types
import { TMDBGenreSchema, TMDBProductionCompanySchema, TMDBMovie } from '../types/tmdb';
import { z } from 'zod'; // Import z for inference
import { Genre } from '@schemas/genre.schema'; // Import full Genre type for cache
import { ProductionCompany } from '@schemas/production-company.schema'; // Import full ProductionCompany type
import logger from '@utils/logger';

// Infer types from schemas
type TMDBGenre = z.infer<typeof TMDBGenreSchema>;
type TMDBProductionCompany = z.infer<typeof TMDBProductionCompanySchema>;

// --- Global Error Handlers ---
process.on('uncaughtException', error => {
    logger.error(error, '!!! Uncaught Exception:');
    process.exit(1); // Exit process on unhandled exceptions
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error(reason, '!!! Unhandled Rejection at:', promise);
    // Optionally exit or log, but be cautious as multiple rejections can occur
    // process.exit(1);
});
// -----------------------------

// Load environment variables
config();

interface PopulateOptions {
    limit?: number;
    date?: string;
    createOnly?: boolean;
}

async function parseArgs(): Promise<PopulateOptions> {
    const options: PopulateOptions = {};

    // Parse command line arguments
    for (let i = 2; i < process.argv.length; i++) {
        const arg = process.argv[i];

        if (arg === '--limit' && i + 1 < process.argv.length) {
            const limitArg = process.argv[++i];
            const limit = parseInt(limitArg, 10);
            if (isNaN(limit) || limit <= 0) {
                logger.error(`Invalid limit: ${limitArg}`);
                process.exit(1);
            }
            options.limit = limit;
        } else if (arg === '--date' && i + 1 < process.argv.length) {
            const dateArg = process.argv[++i];
            // Validate date format (YYYY-MM-DD)
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
                logger.error(`Invalid date format: ${dateArg}. Expected YYYY-MM-DD`);
                process.exit(1);
            }
            options.date = dateArg;
        } else if (arg === '--create-only') {
            options.createOnly = true;
        } else if (arg === '--help') {
            logger.info(`
Usage: ts-node populateMovies.ts [options]

Options:
  --limit <number>    Limit the number of movies to fetch (default: all)
  --date <date>       Fetch TMDB export from specific date (YYYY-MM-DD, defaults to yesterday)
  --create-only       Only fetch and process movies that are not already in the database
  --help              Show this help message
      `);
            process.exit(0);
        }
    }

    return options;
}

async function processSingleMovie(
    movieId: number,
    tmdbService: TMDBService,
    movieRepository: MovieRepository,
    genreRepository: GenreRepository,
    productionCompanyRepository: ProductionCompanyRepository,
    genreCache: Map<string, Genre>,
    companyCache: Map<string, ProductionCompany>
): Promise<void> {
    let dbMovieId: number | null = null;

    // Step 1: Fetch TMDB Details
    const movieDetails = await tmdbService.getMovieDetails(movieId);

    if (!movieDetails) {
        logger.warn(`[${movieId}] Movie not found in TMDB, skipping.`);
        return;
    }

    try {
        // Step 2: Find or Create/Update Movie
        const existingMovie = await movieRepository.findByTmdbId(movieId);
        if (existingMovie) {
            const updatedMovie = await movieRepository.update(existingMovie.id, movieDetails, undefined);
            dbMovieId = updatedMovie?.id ?? null;
        } else {
            const newMovie = await movieRepository.create(movieDetails, undefined);
            dbMovieId = newMovie.id;
        }

        if (!dbMovieId) {
            logger.error(`[${movieId}] Failed to get a database ID for the movie. Skipping related data.`);
            throw new Error(`Failed to obtain dbMovieId for TMDB ID ${movieId}`);
        }

        // Step 3: Process Genres (Using Cache and Promise.all)
        if (movieDetails.genres && movieDetails.genres.length > 0) {
            try {
                const genreIds = await Promise.all(
                    movieDetails.genres.map(async (genre: TMDBGenre) => {
                        const savedGenre = await genreRepository.findOrCreate(genre.name, undefined, genreCache);
                        return savedGenre.id;
                    })
                );
                await genreRepository.addMovieGenres(dbMovieId, genreIds, undefined);
            } catch (genreError) {
                logger.error(`[${movieId}] Error processing genres:`, genreError);
            }
        }

        // Step 4: Process Production Companies (Using Cache and Promise.all)
        if (movieDetails.production_companies && movieDetails.production_companies.length > 0) {
            try {
                const companyIds = await Promise.all(
                    movieDetails.production_companies.map(async (company: TMDBProductionCompany) => {
                        const savedCompany = await productionCompanyRepository.findOrCreate(
                            {
                                name: company.name,
                                logo_path: company.logo_path,
                                origin_country: company.origin_country,
                            },
                            undefined,
                            companyCache
                        );
                        return savedCompany.id;
                    })
                );
                await productionCompanyRepository.addMovieCompanies(dbMovieId, companyIds, undefined);
            } catch (companyError) {
                logger.error(`[${movieId}] Error processing companies:`, companyError);
            }
        }

        // Step 5: Process External IDs (Inside its own transaction)
        if (movieDetails.external_ids) {
            await db.transaction(async (trx: Knex.Transaction) => {
                const externalIds = Object.entries(movieDetails.external_ids!)
                    .filter(([_, value]) => value !== null && value !== undefined && String(value).trim() !== '')
                    .map(([source, external_id]) => {
                        // Transform the source key by removing '_id' suffix if present
                        // E.g., 'imdb_id' becomes 'imdb', but 'tiktok_account' stays 'tiktok_account'
                        const normalizedSource = source.endsWith('_id') 
                            ? source.slice(0, -3) // Remove '_id' suffix
                            : source;
                            
                        return {
                            content_type: 'movie',
                            content_id: dbMovieId,
                            source: normalizedSource,
                            external_id: String(external_id),
                            confidence_score: 1.0,
                            last_verified: new Date().toISOString(),
                        };
                    });

                if (externalIds.length > 0) {
                    // Delete existing external IDs for this movie
                    await trx('external_ids')
                        .where('content_type', 'movie')
                        .where('content_id', dbMovieId)
                        .delete();
                    
                    // Insert the new external IDs
                    await trx('external_ids').insert(externalIds);
                }
            });
        }
    } catch (error) {
        // Keep this error log
        logger.error(error, `[${movieId}] Error during processing steps:`);
        throw error;
    }
}

async function populateMovies(options: PopulateOptions) {
    const tmdbService = new TMDBService();
    const movieRepository = new MovieRepository();
    const genreRepository = new GenreRepository();
    const productionCompanyRepository = new ProductionCompanyRepository();

    // Create in-memory caches
    const genreCache = new Map<string, Genre>();
    const companyCache = new Map<string, ProductionCompany>();

    const CONCURRENCY_LIMIT = 100; // Maximum TMDB API concurrency

    let totalSuccessCount = 0;
    let totalFailureCount = 0;
    let totalProcessed = 0;
    const scriptStartTime = Date.now(); // Record script start time

    try {
        // Determine the date for the export
        const exportDate = options.date ? new Date(options.date) : new Date();

        // Get the list of movie IDs to populate
        let allMovieIds = await tmdbService.getDailyExportMovieIds(exportDate);
        let totalMoviesInExport = allMovieIds.length;
        logger.info(
            `Found ${totalMoviesInExport} movie IDs in TMDB export for ${exportDate.toISOString().split('T')[0]}.`
        );

        // If --create-only flag is set, filter out existing IDs
        if (options.createOnly) {
            logger.info('Checking which movies already exist in the database (create-only mode)...');
            const existingTmdbIds = await movieRepository.findAllTmdbIds(); // Assumes this method exists
            const existingSet = new Set(existingTmdbIds);
            const originalCount = allMovieIds.length;
            allMovieIds = allMovieIds.filter(id => !existingSet.has(id));
            const newCount = allMovieIds.length;
            logger.info(`Filtered out ${originalCount - newCount} existing movies. Processing ${newCount} new movies.`);
        }

        let totalMoviesToProcess = allMovieIds.length;
        // Apply limit *after* filtering if createOnly is set
        const scriptLimit = options.limit;
        if (scriptLimit !== undefined && scriptLimit > 0 && totalMoviesToProcess > scriptLimit) {
            allMovieIds = allMovieIds.slice(0, scriptLimit);
            totalMoviesToProcess = allMovieIds.length;
            logger.info(`Applying limit: processing ${totalMoviesToProcess} movies.`);
        }

        if (totalMoviesToProcess === 0) {
            logger.info('No movies to process based on current options.');
            return; // Exit early if no movies left to process
        }

        logger.info(`Processing ${totalMoviesToProcess} movies with ${CONCURRENCY_LIMIT} concurrent API calls...`);

        // Create chunks of movie IDs, each with CONCURRENCY_LIMIT size
        const chunks = [];
        for (let i = 0; i < totalMoviesToProcess; i += CONCURRENCY_LIMIT) {
            chunks.push(allMovieIds.slice(i, Math.min(i + CONCURRENCY_LIMIT, totalMoviesToProcess)));
        }

        logger.info(`Split processing into ${chunks.length} chunks of up to ${CONCURRENCY_LIMIT} movies each.`);

        // Process each chunk sequentially
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
            const chunk = chunks[chunkIndex];
            const chunkStartTime = Date.now();
            let chunkSuccessCount = 0;
            let chunkFailureCount = 0;

            // Process all movies in this chunk concurrently
            const results = await Promise.all(
                chunk.map(async (movieId) => {
                    try {
                        await processSingleMovie(
                            movieId,
                            tmdbService,
                            movieRepository,
                            genreRepository,
                            productionCompanyRepository,
                            genreCache,
                            companyCache
                        );
                        return { status: 'fulfilled', movieId };
                    } catch (error) {
                        logger.error(error, `[${movieId}] Error during processing:`);
                        return { status: 'rejected', movieId, reason: error };
                    }
                })
            );

            // Count successes and failures in this chunk
            results.forEach(result => {
                if (result.status === 'fulfilled') {
                    chunkSuccessCount++;
                } else {
                    chunkFailureCount++;
                }
            });

            // Update totals
            totalSuccessCount += chunkSuccessCount;
            totalFailureCount += chunkFailureCount;
            totalProcessed += chunk.length;

            // Calculate and show progress after this chunk
            const chunkEndTime = Date.now();
            const chunkDurationMs = chunkEndTime - chunkStartTime;
            const elapsedTime = chunkEndTime - scriptStartTime;
            const moviesPerMillisecond = totalProcessed / elapsedTime;
            const remainingMovies = totalMoviesToProcess - totalProcessed;
            const estimatedRemainingTimeMs = remainingMovies / moviesPerMillisecond;
            
            const chunkDurationSec = (chunkDurationMs / 1000).toFixed(2);
            const etaString = formatTimeString(estimatedRemainingTimeMs);

            logger.info(
                `Chunk ${chunkIndex + 1}/${chunks.length} complete: ${chunkSuccessCount} succeeded, ${chunkFailureCount} failed in ${chunkDurationSec}s. ` +
                `Overall Progress: ${totalProcessed}/${totalMoviesToProcess} (${(totalProcessed / totalMoviesToProcess * 100).toFixed(1)}%). ` +
                `Cache Hits (G/C): ${genreCache.size}/${companyCache.size}. ETA: ${etaString}`
            );
        }

        logger.info(`\n=== Population Complete ===`);
        logger.info(`Total movies processed: ${totalProcessed}`);
        logger.info(`Total successes: ${totalSuccessCount}`);
        logger.info(`Total failures: ${totalFailureCount}`);
    } catch (error) {
        logger.error(error, 'Critical error during movie population setup or processing:');
        process.exit(1);
    }
}

// Helper function to format time string
function formatTimeString(milliseconds: number): string {
    if (!isFinite(milliseconds)) return "Calculating...";
    
    const seconds = Math.round(milliseconds / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
}

async function main() {
    const startTime = Date.now();
    try {
        const options = await parseArgs();
        logger.info('Starting movie population script with options:', options);

        // Call the local populateMovies function with parsed options
        await populateMovies(options);
    } catch (error) {
        logger.error(error, 'Unhandled error in main execution:');
        process.exitCode = 1; // Set exit code to indicate failure
    } finally {
        // Ensure the database connection pool is destroyed
        logger.info('Closing database connection pool...');
        await db.destroy();
        logger.info('Database connection pool closed.');

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        logger.info(`\nTotal script execution time: ${duration.toFixed(2)} seconds.`);

        // Exit explicitly if needed, though closing the pool should be enough
        // process.exit(process.exitCode || 0);
    }
}

// Only run if this file is executed directly
if (require.main === module) {
    main();
}

// Export for testing or importing
export { main, parseArgs };
