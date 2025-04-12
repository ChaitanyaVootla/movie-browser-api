import { Knex } from 'knex';
import { z } from 'zod';

export interface BaseRepository<T, CreateDTO, UpdateDTO, QueryDTO> {
    findAll(query: QueryDTO): Promise<T[]>;
    findById(id: number): Promise<T | null>;
    create(data: CreateDTO, trx?: Knex.Transaction): Promise<T>;
    update(id: number, data: UpdateDTO, trx?: Knex.Transaction): Promise<T | null>;
    delete(id: number, trx?: Knex.Transaction): Promise<boolean>;
    count(query: QueryDTO): Promise<number>;
}

export interface PaginationParams {
    page?: number;
    limit?: number;
}

export class RepositoryError extends Error {
    constructor(
        message: string,
        public readonly cause?: unknown
    ) {
        super(message);
        this.name = 'RepositoryError';
    }
}

// Interface for DTO objects that might contain a transaction
export interface WithTransaction {
    trx?: Knex.Transaction;
}

// Interface for entities with timestamps
export interface WithTimestamps {
    created_at?: string;
    updated_at?: string;
}

export abstract class KnexRepository<
    T extends Record<string, any>,
    CreateDTO extends Partial<WithTimestamps>,
    UpdateDTO extends Partial<WithTimestamps>,
    QueryDTO extends PaginationParams,
> implements BaseRepository<T, CreateDTO, UpdateDTO, QueryDTO>
{
    constructor(
        protected readonly knex: Knex,
        protected readonly tableName: string,
        protected readonly schema: z.ZodType<T>,
        protected readonly createSchema: z.ZodType<CreateDTO>,
        protected readonly updateSchema: z.ZodType<UpdateDTO>,
        protected readonly querySchema: z.ZodType<QueryDTO>
    ) {}

    /**
     * Find all records matching the query
     */
    async findAll(query: QueryDTO): Promise<T[]> {
        try {
            const validatedQuery = this.querySchema.parse(query);
            const { page = 1, limit = 20, ...filters } = validatedQuery;

            const offset = (page - 1) * limit;

            let queryBuilder = this.knex(this.tableName).select('*');

            // Apply filters
            Object.entries(filters).forEach(([key, value]) => {
                if (value !== undefined) {
                    queryBuilder = queryBuilder.where(key, value);
                }
            });

            const results = await queryBuilder.limit(limit).offset(offset);

            return results.map(result => this.schema.parse(result));
        } catch (error) {
            if (error instanceof z.ZodError) {
                throw new RepositoryError(`Invalid query parameters: ${error.message}`, error);
            }
            throw new RepositoryError(`Error finding records in ${this.tableName}`, error);
        }
    }

    /**
     * Find a record by ID
     */
    async findById(id: number): Promise<T | null> {
        try {
            const result = await this.knex(this.tableName).where('id', id).first();
            return result ? this.schema.parse(result) : null;
        } catch (error) {
            if (error instanceof z.ZodError) {
                throw new RepositoryError(`Invalid record format: ${error.message}`, error);
            }
            throw new RepositoryError(`Error finding record with ID ${id} in ${this.tableName}`, error);
        }
    }

    /**
     * Create a new record
     */
    async create(data: CreateDTO & Partial<WithTransaction>, trx?: Knex.Transaction): Promise<T> {
        try {
            const validatedData = { ...this.createSchema.parse(data) } as CreateDTO & WithTimestamps;

            // Extract trx from data if it was passed in the data object
            const transaction = trx || ((validatedData as any).trx as Knex.Transaction | undefined);

            // Remove trx from data if it exists
            if ('trx' in validatedData) {
                const { trx: _, ...dataWithoutTrx } = validatedData as any;
                Object.assign(validatedData, dataWithoutTrx);
            }

            // Set default timestamps
            if (!validatedData.created_at) {
                validatedData.created_at = new Date().toISOString();
            }
            if (!validatedData.updated_at) {
                validatedData.updated_at = new Date().toISOString();
            }

            const query = this.knex(this.tableName).insert(validatedData).returning('*');

            // Use the transaction if provided
            const queryWithTrx = transaction ? query.transacting(transaction) : query;

            const [result] = await queryWithTrx;

            return this.schema.parse(result);
        } catch (error) {
            if (error instanceof z.ZodError) {
                throw new RepositoryError(`Invalid data for ${this.tableName}: ${error.message}`, error);
            }
            throw new RepositoryError(`Error creating record in ${this.tableName}`, error);
        }
    }

    /**
     * Update a record by ID
     */
    async update(id: number, data: UpdateDTO & Partial<WithTransaction>, trx?: Knex.Transaction): Promise<T | null> {
        try {
            const validatedData = { ...this.updateSchema.parse(data) } as UpdateDTO & WithTimestamps;

            // Extract trx from data if it was passed in the data object
            const transaction = trx || ((validatedData as any).trx as Knex.Transaction | undefined);

            // Remove trx from data if it exists
            if ('trx' in validatedData) {
                const { trx: _, ...dataWithoutTrx } = validatedData as any;
                Object.assign(validatedData, dataWithoutTrx);
            }

            // Always update the updated_at timestamp
            validatedData.updated_at = new Date().toISOString();

            const query = this.knex(this.tableName).where('id', id).update(validatedData).returning('*');

            // Use the transaction if provided
            const queryWithTrx = transaction ? query.transacting(transaction) : query;

            const [result] = await queryWithTrx;

            return result ? this.schema.parse(result) : null;
        } catch (error) {
            if (error instanceof z.ZodError) {
                throw new RepositoryError(`Invalid update data for ${this.tableName}: ${error.message}`, error);
            }
            throw new RepositoryError(`Error updating record with ID ${id} in ${this.tableName}`, error);
        }
    }

    /**
     * Delete a record by ID
     */
    async delete(id: number, trx?: Knex.Transaction): Promise<boolean> {
        try {
            const query = this.knex(this.tableName).where('id', id).delete();

            // Use the transaction if provided
            const queryWithTrx = trx ? query.transacting(trx) : query;

            const result = await queryWithTrx;
            return result > 0;
        } catch (error) {
            throw new RepositoryError(`Error deleting record with ID ${id} from ${this.tableName}`, error);
        }
    }

    /**
     * Count records matching the query
     */
    async count(query: QueryDTO): Promise<number> {
        try {
            const validatedQuery = this.querySchema.parse(query);
            const { page, limit, ...filters } = validatedQuery;

            let queryBuilder = this.knex(this.tableName).count('* as count').first();

            // Apply filters
            Object.entries(filters).forEach(([key, value]) => {
                if (value !== undefined) {
                    queryBuilder = queryBuilder.where(key, value);
                }
            });

            const result = await queryBuilder;
            return parseInt((result?.count as string) || '0', 10);
        } catch (error) {
            if (error instanceof z.ZodError) {
                throw new RepositoryError(`Invalid query parameters: ${error.message}`, error);
            }
            throw new RepositoryError(`Error counting records in ${this.tableName}`, error);
        }
    }
}
