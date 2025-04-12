# Movie Browser API

A Node.js API service that enriches the TMDB movie database with additional data such as ratings, reviews, and watch links.

## Project Overview

This project aims to build a modular, scalable, and cost-effective service that leverages external data to enhance the TMDB movie database with:

- External IDs from various services
- Ratings and reviews from platforms like IMDb and Rotten Tomatoes
- Watch links for various streaming services

The API is designed to be easy to use, well-documented, and performance-optimized.

## Features

- High-performance PostgreSQL database for data storage
- Type-safe codebase using TypeScript and Zod validation
- RESTful API endpoints with proper error handling
- Background job scheduling for data updates
- Caching and rate limiting for optimal performance

## Getting Started

### Prerequisites

- Node.js v18+ and npm
- PostgreSQL database
- TMDB API key

### Installation

1. Clone the repository:

    ```
    git clone https://github.com/yourusername/movie-browser-api.git
    cd movie-browser-api
    ```

2. Install dependencies:

    ```
    npm install
    ```

3. Set up environment variables by copying the example file:

    ```
    cp .env.example .env
    ```

    Then edit the `.env` file with your configuration values.

4. Set up the database:
    ```
    npm run migrate
    ```

### Development

Start the development server:

```
npm run dev
```

### Database Setup with Docker

You can use Docker to quickly set up a PostgreSQL database:

```
docker-compose up -d
```

This will start a PostgreSQL container with the configuration specified in the `docker-compose.yml` file.

## Data Population

Populate the database with movies from TMDB:

```
npm run populate:movies
```

Options:

- `--limit <number>`: Limit the number of movies to fetch (default: 1000)
- `--date <date>`: Fetch TMDB export from specific date (format: YYYY-MM-DD)

Example:

```
npm run populate:movies -- --limit 100 --date 2023-04-01
```

## API Endpoints

### Movies

- `GET /api/v1/movies`: Get all movies with pagination and filtering
- `GET /api/v1/movies/:id`: Get movie by ID (supports both TMDB and IMDb IDs)
- `GET /api/v1/movies/tmdb/:tmdbId`: Get movie by TMDB ID
- `GET /api/v1/movies/popular`: Get popular movies
- `GET /api/v1/movies/by-vote-count`: Get movies by vote count

## Project Structure

```
movie-browser-api/
├── src/
│   ├── schemas/           # Zod schemas for validation and type safety
│   ├── types/             # TypeScript type definitions
│   ├── repositories/      # Database access layer
│   ├── services/          # Business logic and external API integration
│   ├── routes/            # API route handlers
│   ├── controllers/       # Request handlers
│   ├── utils/             # Shared utilities
│   ├── config/            # Configuration files
│   ├── scripts/           # Utility scripts
│   └── index.ts           # Application entry point
├── migrations/            # Database migrations
├── knexfile.js            # Knex configuration
└── docker-compose.yml     # Docker configuration
```

## Development Roadmap

- Phase 1: Initial API setup and TMDB data integration ✅
- Phase 2: External IDs and ratings data enrichment
- Phase 3: Watch links integration
- Phase 4: Advanced caching and performance optimization
- Phase 5: User accounts and personalization features

## License

This project is licensed under the ISC License.
