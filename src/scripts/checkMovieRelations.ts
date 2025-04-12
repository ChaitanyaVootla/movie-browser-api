import { config } from 'dotenv';
import db from '../config/database';

// Load environment variables
config();

interface Movie {
    id: number;
    tmdb_id: number;
    title: string;
}

interface Genre {
    id: number;
    name: string;
}

interface ProductionCompany {
    id: number;
    name: string;
    logo_path: string | null;
    origin_country: string | null;
}

async function getMovieWithRelations(movieId: number) {
    try {
        // Get the movie
        const movie = (await db('movies').where('id', movieId).first()) as Movie;

        if (!movie) {
            console.log(`Movie with ID ${movieId} not found`);
            return;
        }

        console.log(`\nMovie: ${movie.title} (ID: ${movie.id}, TMDB ID: ${movie.tmdb_id})`);

        // Get the genres
        const genres = (await db('genres')
            .join('movie_genres', 'genres.id', 'movie_genres.genre_id')
            .where('movie_genres.movie_id', movieId)
            .select('genres.*')) as Genre[];

        console.log(`\nGenres (${genres.length}):`);
        genres.forEach(genre => {
            console.log(`- ${genre.name} (ID: ${genre.id})`);
        });

        // Get the production companies
        const companies = (await db('production_companies')
            .join('movie_production_companies', 'production_companies.id', 'movie_production_companies.company_id')
            .where('movie_production_companies.movie_id', movieId)
            .select('production_companies.*')) as ProductionCompany[];

        console.log(`\nProduction Companies (${companies.length}):`);
        companies.forEach(company => {
            console.log(`- ${company.name} (ID: ${company.id}, Country: ${company.origin_country})`);
        });

        // Get raw join table data
        const genreJoins = await db('movie_genres').where('movie_id', movieId);

        console.log(`\nRaw genre links (${genreJoins.length}):`);
        for (const join of genreJoins) {
            const genre = await db('genres').where('id', join.genre_id).first();
            console.log(`- Genre ID: ${join.genre_id}, Name: ${genre?.name || 'Unknown'}`);
        }

        const companyJoins = await db('movie_production_companies').where('movie_id', movieId);

        console.log(`\nRaw company links (${companyJoins.length}):`);
        for (const join of companyJoins) {
            const company = await db('production_companies').where('id', join.company_id).first();
            console.log(`- Company ID: ${join.company_id}, Name: ${company?.name || 'Unknown'}`);
        }
    } catch (error) {
        console.error('Error checking movie relations:', error);
    } finally {
        // Close the database connection
        await db.destroy();
    }
}

// Parse command line argument for movie ID
const movieId = parseInt(process.argv[2], 10);
if (isNaN(movieId)) {
    console.error('Please provide a valid movie ID as an argument');
    process.exit(1);
}

// Run the function
getMovieWithRelations(movieId);
