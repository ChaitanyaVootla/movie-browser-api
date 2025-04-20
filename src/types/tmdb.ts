import { z } from 'zod';

// Export the Genre schema
export const TMDBGenreSchema = z.object({
    id: z.number(),
    name: z.string(),
});

// Export the Production company schema
export const TMDBProductionCompanySchema = z.object({
    id: z.number(),
    name: z.string(),
    logo_path: z.string().nullable(),
    origin_country: z.string().nullable(),
});

// Cast member schema
export const TMDBCastMemberSchema = z.object({
    id: z.number(),
    name: z.string(),
    character: z.string().nullable(),
    profile_path: z.string().nullable(),
    order: z.number(),
    credit_id: z.string(),
    cast_id: z.number().optional(),
    known_for_department: z.string().nullable().optional(),
});

// Crew member schema
export const TMDBCrewMemberSchema = z.object({
    id: z.number(),
    name: z.string(),
    profile_path: z.string().nullable(),
    department: z.string(),
    job: z.string(),
    credit_id: z.string(),
});

// Credits schema
export const TMDBCreditsSchema = z.object({
    cast: z.array(TMDBCastMemberSchema),
    crew: z.array(TMDBCrewMemberSchema),
});

// External IDs schema - Keep internal unless needed elsewhere
const TMDBExternalIdsSchema = z
    .object({
        imdb_id: z.string().nullable().optional(),
        wikidata_id: z.string().nullable().optional(),
        facebook_id: z.string().nullable().optional(),
        instagram_id: z.string().nullable().optional(),
        twitter_id: z.string().nullable().optional(),
    })
    .catchall(z.string().nullable());

// Movie schema for TMDB responses
export const TMDBMovieSchema = z.object({
    id: z.number(),
    title: z.string(),
    original_title: z.string().nullable().optional(),
    overview: z.string().nullable().optional(),
    release_date: z.string().nullable().optional(),
    runtime: z.number().nullable().optional(),
    vote_average: z.number().nullable().optional(),
    vote_count: z.number().nullable().optional(),
    popularity: z.number().nullable().optional(),
    poster_path: z.string().nullable().optional(),
    backdrop_path: z.string().nullable().optional(),
    original_language: z.string().nullable().optional(),
    adult: z.boolean().default(false),
    status: z.string().nullable().optional(),
    homepage: z.string().nullable().optional(),
    tagline: z.string().nullable().optional(),
    budget: z.number().nullable().optional(),
    revenue: z.number().nullable().optional(),
    tmdb_id: z.number().int().positive().optional(),
    imdb_id: z.string().nullable().optional(),
    genres: z.array(TMDBGenreSchema).optional().default([]),
    production_companies: z.array(TMDBProductionCompanySchema).optional().default([]),
    external_ids: TMDBExternalIdsSchema.optional(),
    credits: TMDBCreditsSchema.optional(),
});

// Export the type derived from the schema
export type TMDBMovie = z.infer<typeof TMDBMovieSchema>;
export type TMDBExternalIds = z.infer<typeof TMDBExternalIdsSchema>;
