import { z } from 'zod';

export const GenreSchema = z.object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(100),
});

export type Genre = z.infer<typeof GenreSchema>;

export const CreateGenreSchema = GenreSchema.omit({ id: true });
export const UpdateGenreSchema = CreateGenreSchema.partial();

// Define the input type for query separately
const GenreQueryInputSchema = z.object({
    page: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
});

// Transform to ensure page and limit are always defined
export const GenreQuerySchema = GenreQueryInputSchema.transform(data => ({
    ...data,
    page: data.page ?? 1,
    limit: data.limit ?? 20,
}));

// Result type with page and limit always defined
export type GenreQuery = z.infer<typeof GenreQuerySchema> & {
    page: number;
    limit: number;
};
