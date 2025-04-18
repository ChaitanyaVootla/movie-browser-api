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
    logger.error('!!! Uncaught Exception:', error);
    process.exit(1); // Exit process on unhandled exceptions
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('!!! Unhandled Rejection at:', promise, 'reason:', reason);
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
                        const sourceMap: Record<string, string> = {
                            imdb_id: 'imdb',
                            wikidata_id: 'wikidata',
                            facebook_id: 'facebook',
                            instagram_id: 'instagram',
                            twitter_id: 'twitter',
                        };
                        return {
                            content_type: 'movie',
                            content_id: dbMovieId,
                            source: sourceMap[source] || source,
                            external_id: String(external_id),
                            confidence_score: 1.0,
                            last_verified: new Date().toISOString(),
                        };
                    });

                await trx('external_ids').where('content_type', 'movie').where('content_id', dbMovieId).delete();

                if (externalIds.length > 0) {
                    await trx('external_ids').insert(externalIds);
                }
            });
        }
    } catch (error) {
        // Keep this error log
        logger.error(`[${movieId}] Error during processing steps:`, error);
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

    const BATCH_SIZE = 100;
    const CONCURRENCY_LIMIT = 100; // Increase TMDB concurrency limit

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

        const totalMoviesToProcess = allMovieIds.length;
        // Apply limit *after* filtering if createOnly is set
        const scriptLimit = options.limit;
        if (scriptLimit !== undefined && scriptLimit > 0 && totalMoviesToProcess > scriptLimit) {
            allMovieIds = allMovieIds.slice(0, scriptLimit);
            const limitedTotal = allMovieIds.length;
            logger.info(`Applying limit: processing ${limitedTotal} movies.`);
            const totalMoviesToProcess = limitedTotal;
        }

        if (totalMoviesToProcess === 0) {
            logger.info('No movies to process based on current options.');
            return; // Exit early if no movies left to process
        }

        logger.info(
            `Processing ${totalMoviesToProcess} movies in batches of ${BATCH_SIZE} (concurrency: ${CONCURRENCY_LIMIT})...`
        );

        // Use async.eachOfLimit for batches
        await async.eachOfLimit(
            Array.from({ length: Math.ceil(totalMoviesToProcess / BATCH_SIZE) }),
            1,
            async (_, batchIndex) => {
                const numericBatchIndex = batchIndex as number;
                const startIndex = numericBatchIndex * BATCH_SIZE;
                const batchIds = allMovieIds.slice(startIndex, Math.min(startIndex + BATCH_SIZE, totalMoviesToProcess));
                const batchNumber = (batchIndex as number) + 1;
                const totalBatches = Math.ceil(totalMoviesToProcess / BATCH_SIZE);

                logger.info(`\n--- Processing Batch ${batchNumber}/${totalBatches} (${batchIds.length} movies) ---`);
                const batchStartTime = Date.now();

                // Use async.mapLimit again for processing movies within the batch
                const results = await async.mapLimit(batchIds, CONCURRENCY_LIMIT, async (movieId: number) => {
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
                        return { status: 'fulfilled', movieId: movieId };
                    } catch (error) {
                        // Catch errors here to allow mapLimit to continue
                        return { status: 'rejected', movieId: movieId, reason: error };
                    }
                });

                // Tally results (works with mapLimit callback format)
                let batchSuccessCount = 0;
                let batchFailureCount = 0;
                results.forEach(result => {
                    if (result.status === 'fulfilled') {
                        batchSuccessCount++;
                    } else {
                        batchFailureCount++;
                        // Log the reason for rejection from the mapLimit result
                        logger.error(`[${result.movieId}] Error during processing steps:`, result.reason);
                    }
                });

                totalSuccessCount += batchSuccessCount;
                totalFailureCount += batchFailureCount;
                totalProcessed += batchIds.length;
                const batchEndTime = Date.now();
                const batchDuration = ((batchEndTime - batchStartTime) / 1000).toFixed(2);
                logger.info(
                    `Batch ${batchNumber} Summary: ${batchSuccessCount} succeeded, ${batchFailureCount} failed in ${batchDuration}s.`
                );

                // --- ETA Calculation ---
                const elapsedTime = Date.now() - scriptStartTime;
                const moviesPerMillisecond = totalProcessed / elapsedTime;
                const remainingMovies = totalMoviesToProcess - totalProcessed;
                const estimatedRemainingTimeMs = remainingMovies / moviesPerMillisecond;

                if (totalProcessed > 0 && isFinite(estimatedRemainingTimeMs)) {
                    // Avoid division by zero / NaN
                    const estimatedRemainingSeconds = Math.round(estimatedRemainingTimeMs / 1000);
                    const hours = Math.floor(estimatedRemainingSeconds / 3600);
                    const minutes = Math.floor((estimatedRemainingSeconds % 3600) / 60);
                    const seconds = estimatedRemainingSeconds % 60;
                    const etaString = `${hours}h ${minutes}m ${seconds}s`;
                    logger.info(
                        `Overall Progress: ${totalProcessed}/${totalMoviesToProcess} movies. Total Failures: ${totalFailureCount}. Cache Hits (G/C): ${genreCache.size}/${companyCache.size}. ETA: ${etaString}`
                    );
                } else {
                    logger.info(
                        `Overall Progress: ${totalProcessed}/${totalMoviesToProcess} movies. Total Failures: ${totalFailureCount}. Cache Hits (G/C): ${genreCache.size}/${companyCache.size}. ETA: Calculating...`
                    );
                }
                // -----------------------
            }
        );

        logger.info(`\n=== Population Complete ===`);
        logger.info(`Total movies processed: ${totalProcessed}`);
        logger.info(`Total successes: ${totalSuccessCount}`);
        logger.info(`Total failures: ${totalFailureCount}`);
    } catch (error) {
        logger.error('Critical error during movie population setup or batch processing:', error);
        process.exit(1);
    }
}

async function main() {
    const startTime = Date.now();
    try {
        const options = await parseArgs();
        logger.info('Starting movie population script with options:', options);

        // Call the local populateMovies function with parsed options
        await populateMovies(options);
    } catch (error) {
        logger.error('Unhandled error in main execution:', error);
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
