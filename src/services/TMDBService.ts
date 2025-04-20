import axios, { AxiosError } from 'axios';
import { gunzip } from 'zlib';
import { promisify } from 'util';
import { MovieRepository } from '@repositories/movie.repository';
import { GenreRepository } from '@repositories/genre.repository';
import { ProductionCompanyRepository } from '@repositories/production-company.repository';
import { TMDBMovie, TMDBMovieSchema } from '../types/tmdb';
import db from '@config/database';
import { z } from 'zod';
import logger from '@utils/logger';

const gunzipAsync = promisify(gunzip);

export class TMDBService {
    private baseUrl: string;
    private apiKey: string;
    private rateLimitDelay = 100; // e.g., 10/sec limit (adjust as needed)
    private lastRequestTime = 0;
    private movieRepository: MovieRepository;
    private genreRepository: GenreRepository;
    private productionCompanyRepository: ProductionCompanyRepository;
    private maxRetries = 3;

    constructor() {
        if (!process.env.TMDB_API_KEY) {
            throw new Error('TMDB_API_KEY is required');
        }
        if (!process.env.TMDB_API_BASE_URL) {
            throw new Error('TMDB_API_BASE_URL is required');
        }
        this.baseUrl = process.env.TMDB_API_BASE_URL;
        this.apiKey = process.env.TMDB_API_KEY;
        this.movieRepository = new MovieRepository();
        this.genreRepository = new GenreRepository();
        this.productionCompanyRepository = new ProductionCompanyRepository();
    }

    private async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async enforceRateLimit(): Promise<void> {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.rateLimitDelay) {
            await this.delay(this.rateLimitDelay - timeSinceLastRequest);
        }
        this.lastRequestTime = Date.now();
    }

    /**
     * Make a rate-limited API request to TMDB with automatic retries
     */
    private async tmdbRequest<T>(url: string, params: Record<string, any> = {}): Promise<T> {
        let retries = 0;

        while (retries <= this.maxRetries) {
            try {
                await this.enforceRateLimit();

                const response = await axios.get(url, {
                    params: {
                        api_key: this.apiKey,
                        ...params,
                    },
                    timeout: 15000,
                });

                return response.data;
            } catch (error) {
                const axiosError = error as AxiosError;

                // If it's a 404, don't retry
                if (axiosError.response?.status === 404) {
                    throw new Error(`Resource not found: ${url}`);
                }

                // If it's a rate limit error (429), wait longer before retrying
                if (axiosError.response?.status === 429) {
                    const retryAfter = parseInt(axiosError.response?.headers['retry-after'] || '1', 10);
                    logger.warn(`Rate limited by TMDB API. Waiting ${retryAfter} seconds before retry.`);
                    await this.delay(retryAfter * 1000);
                    retries++;
                    continue;
                }

                // For server errors (5xx), retry with exponential backoff
                if (axiosError.response?.status && axiosError.response.status >= 500) {
                    const backoff = Math.pow(2, retries) * 1000;
                    logger.warn(`TMDB server error (${axiosError.response.status}). Retrying in ${backoff}ms...`);
                    await this.delay(backoff);
                    retries++;
                    continue;
                }

                // For other errors, don't retry
                logger.error(`Non-retryable error during TMDB request to ${url}:`, error);
                throw error;
            }
        }

        logger.error(`Failed request to ${url} after ${this.maxRetries} retries`);
        throw new Error(`Failed request to ${url} after ${this.maxRetries} retries`);
    }

    async getMovieDetails(movieId: number): Promise<TMDBMovie | null> {
        try {
            const movieData = await this.tmdbRequest<Record<string, any>>(`${this.baseUrl}/movie/${movieId}`, {
                append_to_response: 'credits,keywords,external_ids',
            });

            // Validate response data against schema
            return TMDBMovieSchema.parse(movieData);
        } catch (error) {
            // Only return null for 404 errors
            if (error instanceof Error && error.message.includes('Resource not found')) {
                return null;
            }

            logger.error(error, `Error fetching movie ${movieId}`);
            throw error;
        }
    }

    async getDailyExportMovieIds(date: Date = new Date()): Promise<number[]> {
        // Calculate yesterday's date
        const yesterday = new Date(date);
        yesterday.setDate(date.getDate() - 1);

        // Format yesterday's date as MM_DD_YYYY for TMDB exports (month_day_year)
        const month = String(yesterday.getMonth() + 1).padStart(2, '0');
        const day = String(yesterday.getDate()).padStart(2, '0');
        const year = yesterday.getFullYear();
        const formattedDate = `${month}_${day}_${year}`;

        // The URL now uses MM_DD_YYYY format for yesterday's export
        const url = `http://files.tmdb.org/p/exports/movie_ids_${formattedDate}.json.gz`;

        logger.info(`Fetching movie IDs from ${url}`);

        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data as ArrayBuffer);
            const unzippedData = await gunzipAsync(buffer);
            const lines = unzippedData.toString().split('\n');

            const TMDBExportItemSchema = z.object({
                id: z.number(),
                popularity: z.number(),
            });

            // Parse all valid lines
            const validItems = lines
                .filter(line => line.trim())
                .map(line => {
                    try {
                        return TMDBExportItemSchema.parse(JSON.parse(line));
                    } catch (e) {
                        logger.warn('Invalid line in TMDB export:', line);
                        return null;
                    }
                })
                .filter((item): item is z.infer<typeof TMDBExportItemSchema> => item !== null);

            return validItems.sort((a, b) => b.popularity - a.popularity).map(item => item.id);
        } catch (error) {
            logger.error(`Error fetching daily export for ${formattedDate}:`, error);
            throw error;
        }
    }

    private async processGenres(movieId: number, genres: TMDBMovie['genres']): Promise<void> {
        if (!genres || genres.length === 0) {
            logger.info(`No genres to process for movie ${movieId}`);
            return;
        }

        logger.info(`Processing ${genres.length} genres for movie ${movieId}`);

        try {
            // Create or get all genres first
            const genrePromises = genres.map(genre => this.genreRepository.findOrCreate(genre.name));
            const savedGenres = await Promise.all(genrePromises);
            logger.info(`Saved genres: ${savedGenres.map(g => g.name).join(', ')}`);

            // Link genres to movie
            await this.genreRepository.addMovieGenres(
                movieId,
                savedGenres.map(g => g.id)
            );
            logger.info(`Successfully linked ${savedGenres.length} genres to movie ${movieId}`);
        } catch (error) {
            logger.error(`Error processing genres for movie ${movieId}:`, error);
        }
    }

    private async processProductionCompanies(
        movieId: number,
        companies: TMDBMovie['production_companies']
    ): Promise<void> {
        if (!companies || companies.length === 0) {
            logger.info(`No production companies to process for movie ${movieId}`);
            return;
        }

        logger.info(`Processing ${companies.length} production companies for movie ${movieId}`);

        try {
            // Create or get all companies first
            const companyPromises = companies.map(company => {
                // Normalize the origin_country field
                const originCountry =
                    company.origin_country && company.origin_country.length === 2 ? company.origin_country : null;

                return this.productionCompanyRepository.findOrCreate({
                    name: company.name,
                    logo_path: company.logo_path,
                    origin_country: originCountry,
                });
            });

            const savedCompanies = await Promise.all(companyPromises);
            logger.info(`Saved companies: ${savedCompanies.map(c => c.name).join(', ')}`);

            // Link companies to movie
            await this.productionCompanyRepository.addMovieCompanies(
                movieId,
                savedCompanies.map(c => c.id)
            );
            logger.info(`Successfully linked ${savedCompanies.length} companies to movie ${movieId}`);
        } catch (error) {
            logger.error(`Error processing production companies for movie ${movieId}:`, error);
        }
    }

    private processCredits(movieData: any) {
        if (!movieData.credits) {
            return null;
        }

        // Find the director from crew
        const director = movieData.credits.crew?.find((member: any) => 
            member.job.toLowerCase() === 'director'
        );

        // Get top 10 cast members
        const topCast = (movieData.credits.cast || [])
            .slice(0, 10)
            .map((member: any) => ({
                id: member.id,
                name: member.name,
                character: member.character,
                profile_path: member.profile_path,
                order: member.order
            }));

        return {
            director: director ? {
                id: director.id,
                name: director.name,
                profile_path: director.profile_path
            } : null,
            cast: topCast
        };
    }

    /**
     * Populate the database with movies from the latest TMDB export
     * @param {number} limit - Maximum number of movies to import
     * @returns {Promise<{success: number, failures: number}>} - Success and failure counts
     */
    async populateMovies(limit = 100): Promise<{ success: number; failures: number }> {
        let success = 0;
        let failures = 0;

        try {
            // Get list of movie IDs to process
            const movieIds = await this.getDailyExportMovieIds();
            logger.info(`Found ${movieIds.length} movies to process`);

            // Process movies up to the limit
            for (const movieId of movieIds.slice(0, limit)) {
                try {
                    logger.info(`\n=== Processing movie: ${movieId} (TMDB ID: ${movieId}) ===`);
                    const movieDetails = await this.getMovieDetails(movieId);

                    if (!movieDetails) {
                        logger.info(`Movie ${movieId} not found in TMDB`);
                        failures++;
                        continue;
                    }

                    // Start a transaction
                    await db.transaction(async trx => {
                        // Create or update the movie
                        const movie = await this.movieRepository.findByTmdbId(movieId);
                        let dbMovieId: number;

                        // Process credits
                        const credits = this.processCredits(movieDetails);

                        if (movie) {
                            logger.info(`Movie exists with ID ${movie.id}, updating...`);
                            await this.movieRepository.update(movie.id, {
                                ...movieDetails,
                                credits
                            }, trx);
                            dbMovieId = movie.id;
                        } else {
                            const newMovie = await this.movieRepository.create({
                                ...movieDetails,
                                credits
                            }, trx);
                            dbMovieId = newMovie.id;
                        }

                        // Process genres
                        await this.processGenres(dbMovieId, movieDetails.genres);

                        // Process production companies
                        await this.processProductionCompanies(dbMovieId, movieDetails.production_companies);

                        // Process external IDs
                        if (movieDetails.external_ids) {
                            const externalIds = Object.entries(movieDetails.external_ids)
                                .filter(([_, value]) => value !== null && value !== undefined)
                                .map(([source, external_id]) => {
                                    // Map TMDB external ID sources to our schema
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

                            // Update external IDs
                            await db('external_ids')
                                .where('content_type', 'movie')
                                .where('content_id', dbMovieId)
                                .delete();

                            if (externalIds.length > 0) {
                                await db('external_ids').insert(externalIds);
                            }
                        }
                    });

                    success++;
                } catch (error) {
                    logger.error(`Error processing movie ${movieId}:`, error);
                    failures++;
                }
            }
        } catch (error) {
            logger.error('Error during movie population:', error);
            throw error;
        }

        return { success, failures };
    }
}
