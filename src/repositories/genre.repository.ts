import db from '../config/database';
import { KnexRepository } from './base.repository';
import {
    Genre,
    GenreSchema,
    CreateGenreSchema,
    UpdateGenreSchema,
    GenreQuerySchema,
    GenreQuery,
} from '../schemas/genre.schema';
import { z } from 'zod';
import { Knex } from 'knex';

// Define a more specific query type for repository
export type GenreRepositoryQuery = {
    page: number;
    limit: number;
};

export class GenreRepository extends KnexRepository<Genre, any, any, GenreRepositoryQuery> {
    constructor() {
        super(
            db,
            'genres',
            GenreSchema,
            CreateGenreSchema,
            UpdateGenreSchema,
            GenreQuerySchema as unknown as z.ZodType<GenreRepositoryQuery>
        );
    }

    async findOrCreate(name: string, trx?: Knex.Transaction, cache?: Map<string, Genre>): Promise<Genre> {
        // Check cache first
        if (cache && cache.has(name)) {
            return cache.get(name)!;
        }

        try {
            let query = this.knex(this.tableName).where('name', name).first();
            if (trx) {
                query = query.transacting(trx).forUpdate();
            }
            let genre = await query;

            if (!genre) {
                const createData = { name };
                const createQuery = this.knex(this.tableName).insert(createData).returning('*');
                const queryWithTrx = trx ? createQuery.transacting(trx) : createQuery;

                try {
                    const [newGenre] = await queryWithTrx;
                    genre = newGenre;
                } catch (error: any) {
                    if (error.code === '23505') {
                        console.warn(`Race condition handled for genre: ${name}. Re-fetching...`);
                        let retryQuery = this.knex(this.tableName).where('name', name).first();
                        if (trx) {
                            retryQuery = retryQuery.transacting(trx);
                        }
                        genre = await retryQuery;
                        if (!genre) {
                            throw new Error(`Failed to fetch genre '${name}' after unique constraint violation.`);
                        }
                    } else {
                        throw error;
                    }
                }
            }

            const parsedGenre = this.schema.parse(genre);
            // Add to cache if cache is provided
            if (cache) {
                cache.set(name, parsedGenre);
            }
            return parsedGenre;
        } catch (error) {
            console.error(`Error finding or creating genre '${name}':`, error);
            throw new Error(`Error finding or creating genre '${name}': ${error}`);
        }
    }

    async addMovieGenres(movieId: number, genreIds: number[], trx?: Knex.Transaction): Promise<void> {
        try {
            const bindings = genreIds.map(genreId => ({
                movie_id: movieId,
                genre_id: genreId,
            }));

            if (bindings.length === 0) return;

            const query = this.knex('movie_genres').insert(bindings).onConflict(['movie_id', 'genre_id']).ignore();

            const queryWithTrx = trx ? query.transacting(trx) : query;
            await queryWithTrx;
        } catch (error) {
            console.error(`Error adding genres to movie ${movieId}:`, error);
            throw new Error(`Error adding genres to movie ${movieId}: ${error}`);
        }
    }

    async getMovieGenres(movieId: number): Promise<Genre[]> {
        const results = await this.knex('genres')
            .join('movie_genres', 'genres.id', 'movie_genres.genre_id')
            .where('movie_genres.movie_id', movieId)
            .select('genres.*');

        return results.map(result => this.schema.parse(result));
    }

    async removeMovieGenres(movieId: number): Promise<void> {
        await this.knex('movie_genres').where('movie_id', movieId).delete();
    }
}
