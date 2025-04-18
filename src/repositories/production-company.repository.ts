import db from '@config/database';
import { KnexRepository } from '@repositories/base.repository';
import {
    ProductionCompany,
    ProductionCompanySchema,
    CreateProductionCompanySchema,
    UpdateProductionCompanySchema,
    ProductionCompanyQuerySchema,
    ProductionCompanyQuery,
} from '@schemas/production-company.schema';
import { z } from 'zod';
import { Knex } from 'knex';

// Define a more specific query type for repository
export type ProductionCompanyRepositoryQuery = {
    page: number;
    limit: number;
    origin_country?: string;
};

// Define a simple type for the data structure used in findOrCreate
type CreateProductionCompanyData = {
    name: string;
    logo_path?: string | null;
    origin_country?: string | null;
};

// Adjust type to match schema (omit ID and timestamps)
type CreateProductionCompany = Omit<ProductionCompany, 'id' | 'created_at' | 'updated_at'>;

export class ProductionCompanyRepository extends KnexRepository<
    ProductionCompany,
    any, // Use any for CreateDTO
    any, // Use any for UpdateDTO
    any // Use any for QueryDTO
> {
    constructor() {
        // Pass actual schemas for create/update and z.any() for query schema
        super(
            db,
            'production_companies',
            ProductionCompanySchema,
            CreateProductionCompanySchema, // Pass the actual schema
            UpdateProductionCompanySchema, // Pass the actual schema
            z.any() // Pass z.any() for the querySchema argument
        );
    }

    // Update findOrCreate to use an optional cache
    async findOrCreate(
        data: CreateProductionCompanyData,
        trx?: Knex.Transaction,
        cache?: Map<string, ProductionCompany>
    ): Promise<ProductionCompany> {
        // Check cache first
        if (cache && cache.has(data.name)) {
            // TODO: Potentially update logo/country in cached object if new data provided?
            // For now, just return the cached object.
            return cache.get(data.name)!;
        }

        try {
            const normalizedData = {
                ...data,
                origin_country: data.origin_country && data.origin_country.length === 2 ? data.origin_country : null,
            };

            let query = this.knex(this.tableName).where('name', normalizedData.name).first();
            if (trx) {
                query = query.transacting(trx).forUpdate();
            }
            let company = await query;

            if (!company) {
                const createQuery = this.knex(this.tableName).insert(normalizedData).returning('*');
                const queryWithTrx = trx ? createQuery.transacting(trx) : createQuery;

                try {
                    const [newCompany] = await queryWithTrx;
                    company = newCompany;
                } catch (error: any) {
                    if (error.code === '23505') {
                        console.warn(`Race condition handled for company: ${normalizedData.name}. Re-fetching...`);
                        let retryQuery = this.knex(this.tableName).where('name', normalizedData.name).first();
                        if (trx) {
                            retryQuery = retryQuery.transacting(trx);
                        }
                        company = await retryQuery;
                        if (!company) {
                            throw new Error(
                                `Failed to fetch company '${normalizedData.name}' after unique constraint violation.`
                            );
                        }
                    } else {
                        throw error;
                    }
                }
            }
            // Else if company exists, consider if we need to update logo/country?
            // Current logic doesn't update existing company details if found.

            const parsedCompany = this.schema.parse(company);
            // Add to cache if cache is provided
            if (cache) {
                cache.set(data.name, parsedCompany);
            }
            return parsedCompany;
        } catch (error) {
            console.error(`Error finding or creating production company '${data.name}':`, error);
            throw new Error(`Error finding or creating production company '${data.name}': ${error}`);
        }
    }

    async addMovieCompanies(movieId: number, companyIds: number[], trx?: Knex.Transaction): Promise<void> {
        try {
            const bindings = companyIds.map(companyId => ({
                movie_id: movieId,
                company_id: companyId,
            }));

            if (bindings.length === 0) return;

            // Use the transaction if provided
            const query = this.knex('movie_production_companies')
                .insert(bindings)
                .onConflict(['movie_id', 'company_id'])
                .ignore(); // Ignore duplicates

            const queryWithTrx = trx ? query.transacting(trx) : query;
            await queryWithTrx;
        } catch (error) {
            console.error(`Error adding production companies to movie ${movieId}:`, error);
            throw new Error(`Error adding production companies to movie ${movieId}: ${error}`);
        }
    }

    async getMovieCompanies(movieId: number): Promise<ProductionCompany[]> {
        const results = await this.knex('production_companies')
            .join('movie_production_companies', 'production_companies.id', 'movie_production_companies.company_id')
            .where('movie_production_companies.movie_id', movieId)
            .select('production_companies.*');

        return results.map(result => this.schema.parse(result));
    }

    async removeMovieCompanies(movieId: number): Promise<void> {
        await this.knex('movie_production_companies').where('movie_id', movieId).delete();
    }
}
