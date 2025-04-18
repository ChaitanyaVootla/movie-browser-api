import { URL } from 'url';

interface ExternalIdInfo {
  source: string;
  externalId: string;
}

/**
 * Extracts external ID information from a URL for various sources
 * @param url The URL to extract from
 * @returns Object containing source and externalId, or null if not recognized
 */
export function extractExternalId(url: string): ExternalIdInfo | null {
  try {
    const parsedUrl = new URL(url);

    // Rotten Tomatoes
    if (parsedUrl.hostname === 'www.rottentomatoes.com') {
      const match = parsedUrl.pathname.match(/^\/m\/(.+)$/);
      if (match) {
        return {
          source: 'rottentomatoes',
          externalId: `m/${match[1]}`
        };
      }
    }

    // Metacritic
    if (parsedUrl.hostname === 'www.metacritic.com') {
      const match = parsedUrl.pathname.match(/^\/movie\/(.+)\/critic-reviews\/?$/);
      if (match) {
        return {
          source: 'metacritic',
          externalId: `movie/${match[1]}`
        };
      }
    }

    // IMDb
    if (parsedUrl.hostname === 'www.imdb.com') {
      const match = parsedUrl.pathname.match(/^\/title\/(tt\d+)\/?/);
      if (match) {
        return {
          source: 'imdb',
          externalId: match[1]
        };
      }
    }

    // Letterboxd
    if (parsedUrl.hostname === 'letterboxd.com') {
      const match = parsedUrl.pathname.match(/^\/film\/(.+)\/?$/);
      if (match) {
        return {
          source: 'letterboxd',
          externalId: `film/${match[1]}`
        };
      }
    }

    return null;
  } catch (error) {
    return null;
  }
} 