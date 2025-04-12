import { Router } from 'express';
import {
    getMovies,
    getMovieById,
    getMovieByTmdbId,
    getPopularMovies,
    getMoviesByVoteCount,
} from '../controllers/movie.controller';

const router = Router();

// Get all movies with pagination and filtering
router.get('/', getMovies);

// Get movie by ID (supports both TMDB and IMDb IDs)
router.get('/:id', getMovieById);

// Get movie by TMDB ID
router.get('/tmdb/:tmdbId', getMovieByTmdbId);

// Get popular movies
router.get('/popular', getPopularMovies);

// Get movies by vote count
router.get('/by-vote-count', getMoviesByVoteCount);

export default router;
