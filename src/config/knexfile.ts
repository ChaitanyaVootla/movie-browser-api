import * as dotenv from 'dotenv';
import { Knex } from 'knex';

dotenv.config();

const config: { [key: string]: Knex.Config } = {
    development: {
        client: 'postgresql',
        connection: {
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT || '5432'),
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
        },
        pool: {
            min: 2,
            max: 30,
        },
        migrations: {
            tableName: 'knex_migrations',
            directory: '../migrations',
        },
        seeds: {
            directory: '../seeds',
        },
    },

    production: {
        client: 'postgresql',
        connection: {
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT || '5432'),
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            ssl: { rejectUnauthorized: false },
        },
        pool: {
            min: 2,
            max: 10,
        },
        migrations: {
            tableName: 'knex_migrations',
            directory: '../migrations',
        },
        seeds: {
            directory: '../seeds',
        },
    },
};

export default config;
