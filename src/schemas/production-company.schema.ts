import { z } from 'zod';

export const ProductionCompanySchema = z.object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(255),
    logo_path: z.string().max(255).nullable(),
    origin_country: z.union([z.string().length(2), z.literal('')]).nullable(),
});

export type ProductionCompany = z.infer<typeof ProductionCompanySchema>;

export const CreateProductionCompanySchema = ProductionCompanySchema.omit({ id: true });
export const UpdateProductionCompanySchema = CreateProductionCompanySchema.partial();

// Define the input type for query separately
const ProductionCompanyQueryInputSchema = z.object({
    page: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    origin_country: z.union([z.string().length(2), z.literal('')]).optional(),
});

// Transform to ensure page and limit are always defined
export const ProductionCompanyQuerySchema = ProductionCompanyQueryInputSchema.transform(data => ({
    ...data,
    page: data.page ?? 1,
    limit: data.limit ?? 20,
}));

// Result type with page and limit always defined
export type ProductionCompanyQuery = z.infer<typeof ProductionCompanyQuerySchema> & {
    page: number;
    limit: number;
};
