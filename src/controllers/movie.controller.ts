import { Request, Response } from 'express';
import { MovieRepository } from '@repositories/movie.repository';
import { MovieQuerySchema } from '@schemas/movie.schema';

const movieRepository = new MovieRepository();

export const getMovies = async (req: Request, res: Response): Promise<void> => {
    try {
        // Parse and validate query parameters
        const queryParams = MovieQuerySchema.parse(req.query);

        // Get movies from repository
        const movies = await movieRepository.findAll(queryParams);

        // Get total count for pagination
        const total = await movieRepository.count(queryParams);

        res.status(200).json({
            movies,
            pagination: {
                total,
                page: queryParams.page,
                limit: queryParams.limit,
                pages: Math.ceil(total / queryParams.limit),
            },
        });
    } catch (error) {
        console.error('Error fetching movies:', error);
        res.status(500).json({ error: 'Failed to fetch movies' });
    }
};

export const getMovieById = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = req.params.id;

        // Check if it's an IMDb ID (starts with 'tt')
        if (id.startsWith('tt')) {
            try {
                const movie = await movieRepository.findByImdbId(id);

                if (!movie) {
                    res.status(404).json({ error: 'Movie not found' });
                    return;
                }

                res.status(200).json(movie);
                return;
            } catch (error) {
                console.error('Error fetching movie by IMDb ID:', error);
                res.status(500).json({ error: 'Failed to fetch movie details' });
                return;
            }
        }

        // Otherwise, treat it as a TMDB ID
        const tmdbId = parseInt(id, 10);

        if (isNaN(tmdbId)) {
            res.status(400).json({ error: 'Invalid ID format' });
            return;
        }

        try {
            const movie = await movieRepository.findByTmdbId(tmdbId);

            if (!movie) {
                res.status(404).json({ error: 'Movie not found' });
                return;
            }

            res.status(200).json(movie);
        } catch (error) {
            console.error('Error fetching movie by TMDB ID:', error);
            res.status(500).json({ error: 'Failed to fetch movie details' });
            return;
        }
    } catch (error) {
        console.error('Error in getMovieById:', error);
        res.status(500).json({ error: 'Failed to process request' });
    }
};

export const getMovieByTmdbId = async (req: Request, res: Response): Promise<void> => {
    try {
        const tmdbId = parseInt(req.params.tmdbId, 10);

        if (isNaN(tmdbId)) {
            res.status(400).json({ error: 'Invalid TMDB ID' });
            return;
        }

        const movie = await movieRepository.findByTmdbId(tmdbId);

        if (!movie) {
            res.status(404).json({ error: 'Movie not found' });
            return;
        }

        res.status(200).json(movie);
    } catch (error) {
        console.error('Error fetching movie by TMDB ID:', error);
        res.status(500).json({ error: 'Failed to fetch movie' });
    }
};

export const getPopularMovies = async (req: Request, res: Response): Promise<void> => {
    try {
        const limit = parseInt((req.query.limit as string) || '20', 10);
        const movies = await movieRepository.findPopularMovies(limit);
        res.status(200).json(movies);
    } catch (error) {
        console.error('Error fetching popular movies:', error);
        res.status(500).json({ error: 'Failed to fetch popular movies' });
    }
};

export const getMoviesByVoteCount = async (req: Request, res: Response): Promise<void> => {
    try {
        const minVoteCount = parseInt((req.query.minVoteCount as string) || '1000', 10);
        const limit = parseInt((req.query.limit as string) || '20', 10);
        const movies = await movieRepository.findMoviesByVoteCount(minVoteCount, limit);
        res.status(200).json(movies);
    } catch (error) {
        console.error('Error fetching movies by vote count:', error);
        res.status(500).json({ error: 'Failed to fetch movies by vote count' });
    }
};
