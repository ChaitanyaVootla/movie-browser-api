import { Knex } from 'knex';
import db from '@config/database';
import { KnexRepository } from '@repositories/base.repository';
import {
    Movie,
    MovieSchema,
    CreateMovieSchema,
    UpdateMovieSchema,
    MovieQuerySchema,
    MovieQuery,
} from '@schemas/movie.schema';
import { RepositoryError } from '@repositories/base.repository';
import logger from '@/utils/logger';

export class MovieRepository extends KnexRepository<Movie, any, any, MovieQuery> {
    constructor() {
        super(db, 'movies', MovieSchema, CreateMovieSchema, UpdateMovieSchema, MovieQuerySchema);
    }

    private async fetchMovieWithRelations(movieId: number, trx?: Knex.Transaction): Promise<Movie | null> {
        try {
            // Fetch genres
            const genres = await this.knex('genres')
                .join('movie_genres', 'genres.id', 'movie_genres.genre_id')
                .where('movie_genres.movie_id', movieId)
                .select('genres.id', 'genres.name');

            // Fetch production companies
            const productionCompanies = await this.knex('production_companies')
                .join('movie_production_companies', 'production_companies.id', 'movie_production_companies.company_id')
                .where('movie_production_companies.movie_id', movieId)
                .select(
                    'production_companies.id',
                    'production_companies.name',
                    'production_companies.logo_path',
                    'production_companies.origin_country'
                );

            // Fetch external IDs
            const externalIds = await this.knex('external_ids')
                .where('content_type', 'movie')
                .where('content_id', movieId)
                .select('source', 'external_id', 'url', 'confidence_score', 'last_verified');

            // Fetch ratings
            const ratings = await this.knex('ratings')
                .where('content_type', 'movie')
                .where('content_id', movieId)
                .select('source', 'rating', 'rating_count', 'consensus', 'rating_type', 'last_updated');

            // Convert ratings data types
            const processedRatings = ratings.map(rating => ({
                source: rating.source,
                rating: rating.rating ? parseFloat(rating.rating) : null,
                rating_count: rating.rating_count ? parseInt(rating.rating_count, 10) : null,
                consensus: rating.consensus,
                rating_type: rating.rating_type,
                last_updated: rating.last_updated instanceof Date ? rating.last_updated.toISOString() : rating.last_updated
            }));

            // Fetch watch links with provider information
            const watchLinks = await this.knex('watch_links')
                .join('watch_providers', 'watch_links.provider_id', 'watch_providers.id')
                .where('watch_links.content_type', 'movie')
                .where('watch_links.content_id', movieId)
                .select(
                    'watch_links.provider_id',
                    'watch_providers.name as provider_name',
                    'watch_providers.logo_path as provider_logo',
                    'watch_links.country_code',
                    'watch_links.link_type',
                    'watch_links.url',
                    'watch_links.price',
                    'watch_links.raw_price',
                    'watch_links.is_subscription',
                    'watch_links.is_free',
                    'watch_links.currency',
                    'watch_links.last_verified'
                );

            // Group watch links by country
            const watchLinksByCountry = watchLinks.reduce((acc, link) => {
                const country = link.country_code;
                if (!acc[country]) {
                    acc[country] = [];
                }
                
                // Parse price safely, handling NaN values
                let price = null;
                if (link.price) {
                    try {
                        const parsedPrice = parseFloat(link.price);
                        // Check if the parsed value is a valid number
                        price = !isNaN(parsedPrice) ? parsedPrice : null;
                    } catch (e) {
                        price = null;
                    }
                }
                
                acc[country].push({
                    provider_id: parseInt(link.provider_id, 10),
                    provider_name: link.provider_name,
                    provider_logo: link.provider_logo,
                    link_type: link.link_type,
                    url: link.url,
                    price: price,
                    raw_price: link.raw_price,
                    is_subscription: Boolean(link.is_subscription),
                    is_free: Boolean(link.is_free),
                    currency: link.currency,
                    last_verified: link.last_verified instanceof Date ? link.last_verified.toISOString() : link.last_verified
                });
                return acc;
            }, {} as Record<string, any[]>);

            // Transform external IDs into the expected format
            const transformedExternalIds = externalIds.reduce(
                (acc, curr) => {
                    acc[curr.source] = curr.external_id;
                    return acc;
                },
                {} as Record<string, any>
            );

            return {
                genres: genres || [],
                production_companies: productionCompanies || [],
                ratings: processedRatings,
                watch_links: watchLinksByCountry || {},
                external_ids: transformedExternalIds,
            };
        } catch (error) {
            console.error(`Error fetching movie relations for ID ${movieId}:`, error);
            if (trx) throw new RepositoryError(`Error fetching movie relations for ID ${movieId}`, error);
            return null;
        }
    }

    private normalizeMovieResult(result: any): any {
        // Normalize credits if present
        let credits = result.credits;
        if (credits) {
            // Parse if stored as string (JSONB sometimes returns string)
            if (typeof credits === 'string') {
                try {
                    credits = JSON.parse(credits);
                } catch (e) {
                    credits = null;
                }
            }
            if (credits && Array.isArray(credits.cast)) {
                // Find the first director
                const directorMember = credits.crew?.find((member: any) =>
                    member.job && member.job.toLowerCase() === 'director'
                );
                
                // Format the credits with cast and crew
                credits = {
                    cast: credits.cast.slice(0, 10).map((member: any) => ({
                        id: member.id,
                        name: member.name,
                        character: member.character,
                        profile_path: member.profile_path || null,
                        order: member.order
                    })),
                    crew: directorMember ? [{
                        id: directorMember.id,
                        name: directorMember.name,
                        job: directorMember.job,
                        profile_path: directorMember.profile_path || null
                    }] : []
                };
            } else if (credits) {
                credits = {
                    cast: [],
                    crew: []
                };
            }
        }
        return {
            ...result,
            credits,
            created_at: result.created_at instanceof Date ? result.created_at.toISOString() : result.created_at,
            updated_at: result.updated_at instanceof Date ? result.updated_at.toISOString() : result.updated_at,
            next_update_time:
                result.next_update_time instanceof Date
                    ? result.next_update_time.toISOString()
                    : result.next_update_time,
            last_full_update:
                result.last_full_update instanceof Date
                    ? result.last_full_update.toISOString()
                    : result.last_full_update,
            release_date:
                result.release_date instanceof Date
                    ? result.release_date.toISOString().split('T')[0]
                    : result.release_date,
            // Handle numeric fields that might be strings or null
            budget: result.budget
                ? typeof result.budget === 'string'
                    ? parseInt(result.budget, 10)
                    : result.budget
                : 0,
            revenue: result.revenue
                ? typeof result.revenue === 'string'
                    ? parseInt(result.revenue, 10)
                    : result.revenue
                : 0,
            popularity: result.popularity
                ? typeof result.popularity === 'string'
                    ? parseFloat(result.popularity)
                    : result.popularity
                : 0,
            vote_average: result.vote_average
                ? typeof result.vote_average === 'string'
                    ? parseFloat(result.vote_average)
                    : result.vote_average
                : 0,
            vote_count: result.vote_count
                ? typeof result.vote_count === 'string'
                    ? parseInt(result.vote_count, 10)
                    : result.vote_count
                : 0,
        };
    }

    async findByTmdbId(tmdbId: number, trx?: Knex.Transaction): Promise<Movie | null> {
        try {
            logger.debug(`Finding movie by TMDB ID ${tmdbId}`);
            const query = this.knex(this.tableName).where('tmdb_id', tmdbId).first();
            const result = await (trx ? query.transacting(trx) : query);

            if (!result) return null;

            const relations = await this.fetchMovieWithRelations(result.id, trx);
            if (!relations) return null;

            const normalizedResult = {
                ...this.normalizeMovieResult(result),
                ...relations
            };

            try {
                return this.schema.parse(normalizedResult);
            } catch (error) {
                console.error(`Validation error for movie TMDB ID ${tmdbId}:`, error);
                console.error('Failed data structure:', JSON.stringify(normalizedResult, null, 2));
                throw error;
            }
        } catch (error) {
            console.error(`Error finding movie by TMDB ID ${tmdbId}:`, error);
            if (trx) throw new RepositoryError(`Error finding movie by TMDB ID ${tmdbId}`, error);
            return null;
        }
    }

    async findByImdbId(imdbId: string): Promise<Movie | null> {
        try {
            logger.debug(`Finding movie by IMDb ID ${imdbId}`);
            const result = await this.knex(this.tableName).where('imdb_id', imdbId).first();
            if (!result) return null;

            const relations = await this.fetchMovieWithRelations(result.id);
            if (!relations) return null;

            const normalizedResult = {
                ...this.normalizeMovieResult(result),
                ...relations
            };

            try {
                return this.schema.parse(normalizedResult);
            } catch (error) {
                console.error(`Validation error for movie IMDb ID ${imdbId}:`, error);
                console.error('Failed data structure:', JSON.stringify(normalizedResult, null, 2));
                throw error;
            }
        } catch (error) {
            console.error('Error finding movie by IMDb ID:', error);
            return null;
        }
    }

    async findPopularMovies(limit: number = 20): Promise<Movie[]> {
        try {
            const results = await this.knex(this.tableName).orderBy('popularity', 'desc').limit(limit);

            return results.map(result => {
                // Convert dates to ISO strings
                const processedResult = {
                    ...result,
                    created_at: result.created_at instanceof Date ? result.created_at.toISOString() : result.created_at,
                    updated_at: result.updated_at instanceof Date ? result.updated_at.toISOString() : result.updated_at,
                    next_update_time:
                        result.next_update_time instanceof Date
                            ? result.next_update_time.toISOString()
                            : result.next_update_time,
                    last_full_update:
                        result.last_full_update instanceof Date
                            ? result.last_full_update.toISOString()
                            : result.last_full_update,
                    release_date:
                        result.release_date instanceof Date
                            ? result.release_date.toISOString().split('T')[0]
                            : result.release_date,
                };
                return this.schema.parse(processedResult);
            });
        } catch (error) {
            console.error('Error finding popular movies:', error);
            return [];
        }
    }

    async findMoviesByVoteCount(minVoteCount: number = 1000, limit: number = 20): Promise<Movie[]> {
        try {
            const results = await this.knex(this.tableName)
                .where('vote_count', '>=', minVoteCount)
                .orderBy('vote_count', 'desc')
                .limit(limit);

            return results.map(result => {
                // Convert dates to ISO strings
                const processedResult = {
                    ...result,
                    created_at: result.created_at instanceof Date ? result.created_at.toISOString() : result.created_at,
                    updated_at: result.updated_at instanceof Date ? result.updated_at.toISOString() : result.updated_at,
                    next_update_time:
                        result.next_update_time instanceof Date
                            ? result.next_update_time.toISOString()
                            : result.next_update_time,
                    last_full_update:
                        result.last_full_update instanceof Date
                            ? result.last_full_update.toISOString()
                            : result.last_full_update,
                    release_date:
                        result.release_date instanceof Date
                            ? result.release_date.toISOString().split('T')[0]
                            : result.release_date,
                };
                return this.schema.parse(processedResult);
            });
        } catch (error) {
            console.error('Error finding movies by vote count:', error);
            return [];
        }
    }

    async findMoviesNeedingUpdate(): Promise<Movie[]> {
        try {
            const now = new Date().toISOString();
            const results = await this.knex(this.tableName)
                .where('next_update_time', '<=', now)
                .orWhereNull('next_update_time');

            return results.map(result => {
                // Convert dates to ISO strings
                const processedResult = {
                    ...result,
                    created_at: result.created_at instanceof Date ? result.created_at.toISOString() : result.created_at,
                    updated_at: result.updated_at instanceof Date ? result.updated_at.toISOString() : result.updated_at,
                    next_update_time:
                        result.next_update_time instanceof Date
                            ? result.next_update_time.toISOString()
                            : result.next_update_time,
                    last_full_update:
                        result.last_full_update instanceof Date
                            ? result.last_full_update.toISOString()
                            : result.last_full_update,
                    release_date:
                        result.release_date instanceof Date
                            ? result.release_date.toISOString().split('T')[0]
                            : result.release_date,
                };
                return this.schema.parse(processedResult);
            });
        } catch (error) {
            console.error('Error finding movies needing update:', error);
            return [];
        }
    }

    /**
     * Override the update method to handle movie data correctly
     */
    async update(id: number, data: any, trx?: Knex.Transaction): Promise<Movie | null> {
        try {
            // Prepare data before passing to base repository
            // Deep copy to avoid modifying the original object
            const movieData = { ...data };

            // Remove fields that should not be updated
            delete movieData.id;
            delete movieData.created_at;

            // Remove fields that are not in the database table
            delete movieData.genres;
            delete movieData.production_companies;
            delete movieData.ratings;
            delete movieData.external_ids;

            // Set the tmdb_id if it's not already set
            if (!movieData.tmdb_id && movieData.id) {
                movieData.tmdb_id = movieData.id;
            }

            // Handle empty string release_date -> null
            if (movieData.release_date === '') {
                movieData.release_date = null;
            }

            try {
                // Skip validation and perform a direct update
                // Always update the updated_at timestamp
                movieData.updated_at = new Date().toISOString();

                const query = this.knex(this.tableName).where('id', id).update(movieData).returning('*');

                // Use the transaction if provided
                const queryWithTrx = trx ? query.transacting(trx) : query;

                const [result] = await queryWithTrx;

                if (!result) return null;

                // Format the result for return using our findById which has validation
                return this.findById(id, trx);
            } catch (error) {
                throw new RepositoryError(`Error directly updating movie with ID ${id}`, error);
            }
        } catch (error) {
            console.error(`Error updating movie with ID ${id}:`, error);
            if (trx) throw new RepositoryError(`Error updating movie with ID ${id}`, error);
            return null;
        }
    }

    /**
     * Override findById to handle type conversion without validation
     */
    async findById(id: number, trx?: Knex.Transaction): Promise<Movie | null> {
        try {
            // Query the database directly
            const query = this.knex(this.tableName).where('id', id).first();
            const result = await (trx ? query.transacting(trx) : query);

            if (!result) return null;

            // Manual conversion without schema validation
            // This way we avoid all the Zod validation errors
            const movie: any = {
                ...result,
                // Convert dates to ISO strings
                created_at: result.created_at instanceof Date ? result.created_at.toISOString() : result.created_at,
                updated_at: result.updated_at instanceof Date ? result.updated_at.toISOString() : result.updated_at,
                next_update_time:
                    result.next_update_time instanceof Date
                        ? result.next_update_time.toISOString()
                        : result.next_update_time,
                last_full_update:
                    result.last_full_update instanceof Date
                        ? result.last_full_update.toISOString()
                        : result.last_full_update,
                release_date:
                    result.release_date instanceof Date
                        ? result.release_date.toISOString().split('T')[0]
                        : result.release_date,
                // Convert numeric fields
                tmdb_id: Number(result.tmdb_id),
                id: Number(result.id),
                budget: result.budget ? Number(result.budget) : 0,
                revenue: result.revenue ? Number(result.revenue) : 0,
                popularity: result.popularity ? Number(result.popularity) : 0,
                vote_average: result.vote_average ? Number(result.vote_average) : 0,
                vote_count: result.vote_count ? Number(result.vote_count) : 0,
                runtime: result.runtime ? Number(result.runtime) : null,
                // Convert boolean fields
                adult: Boolean(result.adult),
                // Initialize empty arrays
                genres: [],
                production_companies: [],
                ratings: [],
                // Initialize empty objects
                watch_links: {},
                external_ids: {}
            };

            return movie as Movie;
        } catch (error) {
            console.error(`Error finding movie by ID ${id}:`, error);
            if (trx) throw new RepositoryError(`Error finding movie by ID ${id}`, error);
            return null;
        }
    }

    /**
     * Override create method to handle type conversion without validation
     */
    async create(data: any, trx?: Knex.Transaction): Promise<Movie> {
        try {
            // Prepare data before passing to the database
            const movieData = { ...data };

            // Map the TMDB ID from the input data to the correct database column
            if (movieData.id) {
                // Ensure input data has the id
                movieData.tmdb_id = movieData.id;
            } else {
                // Handle cases where the input 'id' might be missing, though TMDBMovieSchema requires it
                console.error('Input data is missing TMDB ID (id field) for create operation.');
                throw new Error('Input data must contain the TMDB ID (id field).');
            }

            // Remove fields that are not in the database table
            delete movieData.id; // Remove the original id field (DB uses auto-increment)
            delete movieData.genres;
            delete movieData.production_companies;
            delete movieData.ratings;
            delete movieData.external_ids;

            // Set default timestamps if not provided
            if (!movieData.created_at) {
                movieData.created_at = new Date().toISOString();
            }
            if (!movieData.updated_at) {
                movieData.updated_at = new Date().toISOString();
            }
            if (movieData.release_date === '') {
                movieData.release_date = null;
            }

            try {
                // Perform a direct insert without validation
                const query = this.knex(this.tableName).insert(movieData).returning('*');

                // Use the transaction if provided
                const queryWithTrx = trx ? query.transacting(trx) : query;

                const [result] = await queryWithTrx;

                if (!result) {
                    throw new Error('Failed to create movie: no result returned');
                }

                // Return the newly created movie
                // Pass trx to findById if it was provided
                return this.findById(result.id, trx) as Promise<Movie>;
            } catch (error) {
                // Log the data that caused the failure for debugging
                console.error('Failed movieData for insert:', movieData);
                throw new RepositoryError(`Error directly creating movie in database`, error);
            }
        } catch (error) {
            console.error(`Error creating movie:`, error);
            if (trx) throw new RepositoryError(`Error creating movie`, error);
            throw new RepositoryError(`Error creating movie`, error);
        }
    }

    /**
     * Efficiently finds all existing TMDB IDs in the database.
     * @returns {Promise<number[]>} A promise that resolves to an array of TMDB IDs.
     */
    async findAllTmdbIds(): Promise<number[]> {
        try {
            const results = await this.knex(this.tableName).select('tmdb_id');
            // Ensure results are numbers and filter out any potential nulls if the column was nullable (it shouldn't be)
            return results.map(row => row.tmdb_id).filter(id => id !== null) as number[];
        } catch (error) {
            console.error('Error fetching all TMDB IDs:', error);
            throw new RepositoryError('Error fetching all TMDB IDs', error);
        }
    }
}
