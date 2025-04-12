import knex from 'knex';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

// Get the environment
const environment = process.env.NODE_ENV || 'development';

// Import the knexfile from project root
// eslint-disable-next-line @typescript-eslint/no-var-requires
const knexConfig = require(path.join(__dirname, '../../knexfile'));

// Create database connection
const db = knex(knexConfig[environment]);

// Test the connection
db.raw('SELECT 1')
    .then(() => {
        console.log(`Database connected successfully in ${environment} mode`);
    })
    .catch(err => {
        console.error('Database connection failed:', err);
        process.exit(1); // Exit on database connection failure
    });

export default db;
