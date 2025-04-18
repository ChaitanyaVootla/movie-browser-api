import { z } from 'zod';
import { TMDBMovieSchema } from '../types/tmdb';

// Genre schema
const GenreSchema = z.object({
    id: z.number(),
    name: z.string(),
});

// Production company schema
const ProductionCompanySchema = z.object({
    id: z.number(),
    name: z.string(),
    logo_path: z.string().nullable(),
    origin_country: z.string().nullable(),
});

// Cast member schema
const CastMemberSchema = z.object({
    id: z.number(),
    name: z.string(),
    character: z.string().nullable(),
    profile_path: z.string().nullable(),
    order: z.number(),
});

// Crew member schema
const CrewMemberSchema = z.object({
    id: z.number(),
    name: z.string(),
    job: z.string(),
    profile_path: z.string().nullable(),
});

// Credits schema
const CreditsSchema = z.object({
    cast: z.array(CastMemberSchema).max(10),
    crew: z.array(CrewMemberSchema),
});

// External IDs schema
const ExternalIdsSchema = z
    .object({
        imdb_id: z.string().nullable().optional(),
        wikidata_id: z.string().nullable().optional(),
        facebook_id: z.string().nullable().optional(),
        instagram_id: z.string().nullable().optional(),
        twitter_id: z.string().nullable().optional(),
        // Additional external IDs we might get from other sources
        tvdb_id: z.number().nullable().optional(),
        tvrage_id: z.number().nullable().optional(),
        freebase_mid: z.string().nullable().optional(),
        freebase_id: z.string().nullable().optional(),
        rotten_tomatoes_id: z.string().nullable().optional(),
        metacritic_id: z.string().nullable().optional(),
        letterboxd_id: z.string().nullable().optional(),
    })
    .catchall(z.string().nullable());

// Rating schema
const RatingSchema = z.object({
    source: z.string(),
    rating: z.number().nullable(),
    rating_count: z.number().nullable(),
    consensus: z.string().nullable(),
    rating_type: z.string(),
    last_updated: z.string().nullable(),
});

// Watch Link schema
const WatchLinkSchema = z.object({
    provider_id: z.number(),
    provider_name: z.string(),
    provider_logo: z.string().nullable(),
    link_type: z.string(),
    url: z.string(),
    price: z.number().nullable().optional(),
    raw_price: z.string().nullable().optional(),
    is_subscription: z.boolean().optional(),
    is_free: z.boolean().optional(),
    currency: z.string().nullable().optional(),
    last_verified: z.string().nullable().optional()
});

// Watch Links by Country schema
const WatchLinksByCountrySchema = z.record(z.string(), z.array(WatchLinkSchema));

// Accept any string as a URL, and also allow null
const urlSchema = z.string().nullable().optional();

// Base movie schema - extends TMDB schema with our additional fields and constraints
const BaseMovieSchema = TMDBMovieSchema.extend({
    // Override id to make it optional (for new records)
    id: z.number().int().positive().optional(),
    // Make genres and production_companies optional when retrieving data from DB
    genres: z.array(GenreSchema).optional(),
    production_companies: z.array(ProductionCompanySchema).optional(),
    // Add credits
    credits: CreditsSchema.nullable().optional(),
    // Add our own fields
    next_update_time: z.string().nullable().optional(), // ISO date string
    update_frequency: z.string().nullable().optional(), // ISO duration string
    last_full_update: z.string().nullable().optional(), // ISO date string
    created_at: z.string().nullable().optional(), // ISO date string
    updated_at: z.string().nullable().optional(), // ISO date string
    // Add ratings which isn't in TMDB schema
    ratings: z.array(RatingSchema).nullable().optional(),
    // Add watch links grouped by country
    watch_links: WatchLinksByCountrySchema.nullable().optional(),
    // Add external IDs
    external_ids: ExternalIdsSchema.optional(),
    // Override homepage with more lenient validation
    homepage: urlSchema,
});

// Add validation transforms
const movieTransform = (movie: any) => ({
    ...movie,
    // Add additional validation/constraints
    title: movie.title?.slice(0, 255) || '',
    original_title: movie.original_title?.slice(0, 255),
    original_language: movie.original_language?.slice(0, 10),
    // No URL validation here since we're using the urlSchema above
    homepage: movie.homepage || null,
    // Ensure arrays are initialized
    genres: movie.genres || [],
    production_companies: movie.production_companies || [],
});

// Transform function for updating movies that doesn't include genres/production_companies
const movieUpdateTransform = (movie: any) => ({
    ...movie,
    // Add additional validation/constraints
    title: movie.title?.slice(0, 255) || '',
    original_title: movie.original_title?.slice(0, 255),
    original_language: movie.original_language?.slice(0, 10),
    // No URL validation here since we're using the urlSchema above
    homepage: movie.homepage || null,
    // Do not include genres and production_companies for updates
});

// Full movie schema with transforms
export const MovieSchema = BaseMovieSchema.transform(movieTransform);

// Type for a movie
export type Movie = z.infer<typeof MovieSchema>;

// Base schema for creating a movie
const createMovieShape = {
    tmdb_id: z.number().int().positive(),
    imdb_id: z.string().nullable().optional(),
    title: z.string(),
    original_title: z.string().nullable().optional(),
    overview: z.string().nullable().optional(),
    tagline: z.string().nullable().optional(),
    release_date: z.string().nullable().optional(),
    runtime: z.number().int().nullable().optional(),
    budget: z.number().int().nullable().optional(),
    revenue: z.number().int().nullable().optional(),
    popularity: z.number().nullable().optional(),
    vote_average: z.number().nullable().optional(),
    vote_count: z.number().int().nullable().optional(),
    adult: z.boolean(),
    status: z.string().nullable().optional(),
    homepage: urlSchema,
    poster_path: z.string().nullable().optional(),
    backdrop_path: z.string().nullable().optional(),
    original_language: z.string().nullable().optional(),
    next_update_time: z.string().nullable().optional(),
    update_frequency: z.string().nullable().optional(),
    last_full_update: z.string().nullable().optional(),
};

// Schema for creating a new movie
export const CreateMovieSchema = z.object(createMovieShape).transform(movieTransform);

// Schema for updating a movie - use a different transform function
export const UpdateMovieSchema = z.object(createMovieShape).partial().transform(movieUpdateTransform);

// Schema for movie query parameters
export const MovieQuerySchema = z
    .object({
        vote_count_min: z.number().int().min(0).optional(),
        year: z.number().int().min(1900).max(2100).optional(),
        genre: z.number().int().positive().optional(),
        page: z.number().int().min(1),
        limit: z.number().int().min(1).max(100),
    })
    .transform(data => ({
        ...data,
        page: data.page ?? 1,
        limit: data.limit ?? 20,
    }));

export type MovieQuery = z.infer<typeof MovieQuerySchema>;
