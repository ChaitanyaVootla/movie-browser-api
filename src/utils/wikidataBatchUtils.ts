import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import logger from './logger';

/**
 * Interface for the structure of movie external IDs from Wikidata
 */
export interface WikidataMovieIds {
  movie: string;
  movieLabel: string;
  imdbId?: string;
  tmdbId?: string;
  rottentomatoesId?: string;
  metacriticId?: string;
  letterboxdId?: string;
  netflixId?: string;
  primeVideoId?: string;
  appleId?: string;
  hotstarId?: string;
}

/**
 * Mapping of Wikidata property IDs to our internal source names
 */
export const EXTERNAL_ID_SOURCE_MAP: Record<string, string> = {
  imdbId: 'imdb',
  tmdbId: 'tmdb',
  rottentomatoesId: 'rottentomatoes',
  metacriticId: 'metacritic',
  letterboxdId: 'letterboxd',
  netflixId: 'netflix',
  primeVideoId: 'prime',
  appleId: 'apple',
  hotstarId: 'hotstar',
};

/**
 * Confidence scores for different external ID sources from Wikidata
 * Wikidata is considered a very reliable source, so we assign high confidence
 */
export const EXTERNAL_ID_CONFIDENCE: Record<string, number> = {
  wikidata: 0.98, // Wikidata ID itself has highest confidence
  imdb: 0.95,     // IMDb IDs in Wikidata are typically very accurate
  tmdb: 0.95,     // TMDb IDs in Wikidata are typically very accurate
  rottentomatoes: 0.90,
  metacritic: 0.90,
  letterboxd: 0.90,
  netflix: 0.90,
  prime: 0.90,
  apple: 0.90,
  hotstar: 0.90,
};

/**
 * Fetches all movies' external IDs from Wikidata and writes them to a JSON file
 * @param outputFilePath Path to save the JSON file
 * @param limit Optional limit to the number of results (for testing)
 * @returns Path to the created file
 */
export async function fetchAllMovieExternalIds(
  outputFilePath: string,
  limit?: number
): Promise<string> {
  const query = `
    SELECT DISTINCT ?movie ?movieLabel (SAMPLE(?imdbId) AS ?imdbId) (SAMPLE(?tmdbId) AS ?tmdbId) 
        (SAMPLE(?rottentomatoesId) AS ?rottentomatoesId) (SAMPLE(?metacriticId) AS ?metacriticId) 
        (SAMPLE(?letterboxdId) AS ?letterboxdId) (SAMPLE(?netflixId) AS ?netflixId) 
        (SAMPLE(?primeVideoId) AS ?primeVideoId) (SAMPLE(?appleId) AS ?appleId) 
        (SAMPLE(?hotstarId) AS ?hotstarId) 
    WHERE {
        ?movie wdt:P31 wd:Q11424.  # Instance of "film"

        # Require at least one of IMDb ID or TMDb ID
        ?movie wdt:P345|wdt:P4947 ?id.
        
        OPTIONAL { ?movie wdt:P345 ?imdbId. }             # IMDb ID (optional)
        OPTIONAL { ?movie wdt:P4947 ?tmdbId. }            # TMDb ID (optional)
        OPTIONAL { ?movie wdt:P1258 ?rottentomatoesId. }  # Rotten Tomatoes ID (optional)
        OPTIONAL { ?movie wdt:P1712 ?metacriticId. }      # Metacritic ID (optional)
        OPTIONAL { ?movie wdt:P6127 ?letterboxdId. }      # Letterboxd ID (optional)
        OPTIONAL { ?movie wdt:P1874 ?netflixId. }         # Netflix ID (optional)
        OPTIONAL { ?movie wdt:P8055 ?primeVideoId. }      # Prime Video ID (optional)
        OPTIONAL { ?movie wdt:P9586 ?appleId. }           # Apple ID (optional)
        OPTIONAL { ?movie wdt:P11049 ?hotstarId. }        # Jio Hotstar ID (optional)
        
        SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE]". }
    }
    GROUP BY ?movie ?movieLabel
    ${limit ? `LIMIT ${limit}` : ''}
  `;

  const url = 'https://query.wikidata.org/sparql';
  const params = new URLSearchParams({
    query,
    format: 'json',
  });

  logger.info('Fetching movie external IDs from Wikidata...');
  
  try {
    const response = await fetch(`${url}?${params.toString()}`, {
      headers: {
        'Accept': 'application/sparql-results+json',
        'User-Agent': 'movie-browser-api/1.0 (https://github.com/your-repo)',
      },
    });

    if (!response.ok) {
      throw new Error(`Wikidata SPARQL query failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const results = data.results.bindings;
    logger.info(`Fetched ${results.length} movies from Wikidata`);

    // Process the results
    const processedResults = results.map((binding: any) => {
      const result: Partial<WikidataMovieIds> = {
        movie: binding.movie.value.replace('http://www.wikidata.org/entity/', ''),
        movieLabel: binding.movieLabel.value,
      };

      // Extract all available IDs
      Object.keys(EXTERNAL_ID_SOURCE_MAP).forEach((key) => {
        if (binding[key] && binding[key].value) {
          result[key as keyof WikidataMovieIds] = binding[key].value;
        }
      });

      return result;
    });

    // Ensure the directory exists
    const dir = path.dirname(outputFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write to file
    fs.writeFileSync(
      outputFilePath,
      JSON.stringify(processedResults, null, 2)
    );

    logger.info(`Successfully wrote ${processedResults.length} movie external IDs to ${outputFilePath}`);
    return outputFilePath;
  } catch (error) {
    logger.error('Error fetching or saving Wikidata movie external IDs:', error);
    throw error;
  }
}

/**
 * Reads movie external IDs from a JSON file
 * @param filePath Path to the JSON file
 * @returns Array of movie external IDs
 */
export function readMovieExternalIds(filePath: string): WikidataMovieIds[] {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(fileContent) as WikidataMovieIds[];
  } catch (error) {
    logger.error(`Error reading movie external IDs from ${filePath}:`, error);
    throw error;
  }
} 