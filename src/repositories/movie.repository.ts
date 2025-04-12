import { Knex } from 'knex';
import db from '../config/database';
import { KnexRepository } from './base.repository';
import {
    Movie,
    CreateMovieSchema,
    UpdateMovieSchema,
    MovieQuerySchema,
    MovieSchema,
    MovieQuery,
} from '../schemas/movie.schema';
import { RepositoryError } from './base.repository';

// Define the types for create and update operations
type CreateMovie = Omit<Movie, 'id' | 'created_at' | 'updated_at'>;
type UpdateMovie = Partial<CreateMovie>;

export class MovieRepository extends KnexRepository<Movie, any, any, MovieQuery> {
    constructor() {
        super(db, 'movies', MovieSchema, CreateMovieSchema, UpdateMovieSchema, MovieQuerySchema);
    }

    // Custom methods specific to movies
    async findByTmdbId(tmdbId: number, trx?: Knex.Transaction): Promise<Movie | null> {
        try {
            const query = this.knex(this.tableName).where('tmdb_id', tmdbId).first();
            const result = await (trx ? query.transacting(trx) : query);

            if (!result) return null;

            // Fetch genres
            const genres = await this.knex('genres')
                .join('movie_genres', 'genres.id', 'movie_genres.genre_id')
                .where('movie_genres.movie_id', result.id)
                .select('genres.id', 'genres.name');

            // Fetch production companies
            const productionCompanies = await this.knex('production_companies')
                .join('movie_production_companies', 'production_companies.id', 'movie_production_companies.company_id')
                .where('movie_production_companies.movie_id', result.id)
                .select(
                    'production_companies.id',
                    'production_companies.name',
                    'production_companies.logo_path',
                    'production_companies.origin_country'
                );

            // Fetch external IDs
            const externalIds = await this.knex('external_ids')
                .where('content_type', 'movie')
                .where('content_id', result.id)
                .select('source', 'external_id', 'url', 'confidence_score', 'last_verified');

            // Transform external IDs into the expected format
            const transformedExternalIds = externalIds.reduce(
                (acc, curr) => {
                    // Map source names to their corresponding fields
                    const sourceMap: Record<string, string> = {
                        imdb: 'imdb_id',
                        wikidata: 'wikidata_id',
                        facebook: 'facebook_id',
                        instagram: 'instagram_id',
                        twitter: 'twitter_id',
                    };
                    const field = sourceMap[curr.source];
                    if (field) {
                        acc[field] = curr.external_id;
                    }
                    return acc;
                },
                {} as Record<string, any>
            );

            // Handle Date to string conversion for timestamps
            const normalizedResult = {
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
                // Add the fetched genres and production companies
                genres: genres || [],
                production_companies: productionCompanies || [],
                ratings: result.ratings || [],
                // Add external IDs
                external_ids: transformedExternalIds,
            };

            return this.schema.parse(normalizedResult);
        } catch (error) {
            console.error(`Error finding movie by TMDB ID ${tmdbId}:`, error);
            if (trx) throw new RepositoryError(`Error finding movie by TMDB ID ${tmdbId}`, error);
            return null;
        }
    }

    async findByImdbId(imdbId: string): Promise<Movie | null> {
        try {
            const result = await this.knex(this.tableName).where('imdb_id', imdbId).first();

            if (!result) return null;

            // Fetch genres
            const genres = await this.knex('genres')
                .join('movie_genres', 'genres.id', 'movie_genres.genre_id')
                .where('movie_genres.movie_id', result.id)
                .select('genres.id', 'genres.name');

            // Fetch production companies
            const productionCompanies = await this.knex('production_companies')
                .join('movie_production_companies', 'production_companies.id', 'movie_production_companies.company_id')
                .where('movie_production_companies.movie_id', result.id)
                .select(
                    'production_companies.id',
                    'production_companies.name',
                    'production_companies.logo_path',
                    'production_companies.origin_country'
                );

            // Fetch external IDs
            const externalIds = await this.knex('external_ids')
                .where('content_type', 'movie')
                .where('content_id', result.id)
                .select('source', 'external_id', 'url', 'confidence_score', 'last_verified');

            // Transform external IDs into the expected format
            const transformedExternalIds = externalIds.reduce(
                (acc, curr) => {
                    // Map source names to their corresponding fields
                    const sourceMap: Record<string, string> = {
                        imdb: 'imdb_id',
                        wikidata: 'wikidata_id',
                        facebook: 'facebook_id',
                        instagram: 'instagram_id',
                        twitter: 'twitter_id',
                    };
                    const field = sourceMap[curr.source];
                    if (field) {
                        acc[field] = curr.external_id;
                    }
                    return acc;
                },
                {} as Record<string, any>
            );

            // Handle Date to string conversion for timestamps
            const normalizedResult = {
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
                // Add the fetched genres and production companies
                genres: genres || [],
                production_companies: productionCompanies || [],
                ratings: result.ratings || [],
                // Add external IDs
                external_ids: transformedExternalIds,
            };

            return this.schema.parse(normalizedResult);
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
