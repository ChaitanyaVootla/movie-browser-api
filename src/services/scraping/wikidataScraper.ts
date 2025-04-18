import fetch from 'node-fetch';

/**
 * Fetches external IDs for a movie from Wikidata using its Wikidata ID (e.g., Q12345).
 * Returns a map of external IDs (imdb, tmdb, rottentomatoes, metacritic, letterboxd, netflix, prime, apple, hotstar).
 */
export async function fetchWikidataExternalIds(wikidataId: string): Promise<Record<string, string | null>> {
    // SPARQL query for a single movie by Wikidata ID
    const query = `
        SELECT DISTINCT ?movie (SAMPLE(?imdbId) AS ?imdbId) (SAMPLE(?tmdbId) AS ?tmdbId)
            (SAMPLE(?rottentomatoesId) AS ?rottentomatoesId) (SAMPLE(?metacriticId) AS ?metacriticId)
            (SAMPLE(?letterboxdId) AS ?letterboxdId) (SAMPLE(?netflixId) AS ?netflixId)
            (SAMPLE(?primeVideoId) AS ?primeVideoId) (SAMPLE(?appleId) AS ?appleId)
            (SAMPLE(?hotstarId) AS ?hotstarId)
        WHERE {
            BIND(wd:${wikidataId} AS ?movie)
            OPTIONAL { ?movie wdt:P345 ?imdbId. }
            OPTIONAL { ?movie wdt:P4947 ?tmdbId. }
            OPTIONAL { ?movie wdt:P1258 ?rottentomatoesId. }
            OPTIONAL { ?movie wdt:P1712 ?metacriticId. }
            OPTIONAL { ?movie wdt:P6127 ?letterboxdId. }
            OPTIONAL { ?movie wdt:P1874 ?netflixId. }
            OPTIONAL { ?movie wdt:P8055 ?primeVideoId. }
            OPTIONAL { ?movie wdt:P9586 ?appleId. }
            OPTIONAL { ?movie wdt:P11049 ?hotstarId. }
        }
        GROUP BY ?movie
    `;
    const url = 'https://query.wikidata.org/sparql';
    const params = new URLSearchParams({
        query,
        format: 'json',
    });
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
    const bindings = data.results.bindings[0];
    // Map the results to a simple object
    return {
        imdb_id: bindings?.imdbId?.value || null,
        tmdb_id: bindings?.tmdbId?.value || null,
        rottentomatoes_id: bindings?.rottentomatoesId?.value || null,
        metacritic_id: bindings?.metacriticId?.value || null,
        letterboxd_id: bindings?.letterboxdId?.value || null,
        netflix_id: bindings?.netflixId?.value || null,
        prime_id: bindings?.primeVideoId?.value || null,
        apple_id: bindings?.appleId?.value || null,
        hotstar_id: bindings?.hotstarId?.value || null,
    };
} 