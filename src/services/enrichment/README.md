# Ratings Enrichment Service

This service enriches movies and TV shows with ratings from external sources like IMDb and Rotten Tomatoes.

## Overview

The ratings enrichment service:

1. Checks for existing ratings in the database
2. If not found, uses the `ratingsScraper.ts` service to scrape ratings from IMDb and Rotten Tomatoes
3. Inserts the scraped ratings into the database

## Database Schema

The ratings are stored in the `ratings` table with the following structure:

```sql
CREATE TABLE ratings (
    id SERIAL PRIMARY KEY,
    content_type VARCHAR(10) NOT NULL,  -- 'movie' or 'tv'
    content_id INTEGER NOT NULL,        -- References movies.id or tv_series.id
    source VARCHAR(50) NOT NULL,        -- e.g., 'imdb', 'rottentomatoes'
    rating DECIMAL(3,1),                -- Numeric rating
    rating_count INTEGER,               -- Number of ratings
    consensus TEXT,                     -- One-line consensus/review
    rating_type VARCHAR(20) NOT NULL,   -- e.g., 'main', 'critic', 'audience'
    details JSONB,                      -- Store source-specific extras
    last_updated TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(content_type, content_id, source, rating_type)
);
```

## Usage

### Enriching All Content

To enrich all movies and TV shows with ratings, run:

```bash
npx ts-node src/scripts/enrichRatings.ts
```

This script will:

1. Find all movies and TV shows with external IDs
2. Process them in batches of 5
3. Log the results

### Enriching a Single Content Item

To enrich a specific movie or TV show, run:

```bash
npx ts-node src/scripts/enrichSingleContent.ts <contentType> <contentId>
```

Example:

```bash
npx ts-node src/scripts/enrichSingleContent.ts movie 1
```

## Implementation Details

### RatingsEnricher Class

The `RatingsEnricher` class provides the following methods:

- `enrichContent(contentType, contentId)`: Enriches a single content item with ratings
- `processBatch(contentType, contentIds, batchSize)`: Processes multiple content items in batches

### Data Flow

1. The enricher checks for existing ratings in the database
2. If ratings are missing, it retrieves external IDs (IMDb, Rotten Tomatoes) from the `external_ids` table
3. It uses the `ratingsScraper.ts` service to scrape ratings from the external sources
4. The scraped ratings are inserted into the `ratings` table

### Rating Types

The service supports the following rating types:

- `main`: The main rating from a source (e.g., IMDb rating)
- `critic`: Critic ratings from Rotten Tomatoes
- `audience`: Audience ratings from Rotten Tomatoes

## Dependencies

- `knex`: For database operations
- `node-fetch`: For making HTTP requests
- `cheerio`: For parsing HTML

## Future Improvements

- Add support for more rating sources
- Implement rate limiting for external API calls
- Add retry logic for failed scraping attempts
- Implement a queue system for processing large batches
