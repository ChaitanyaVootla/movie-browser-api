import { Knex } from 'knex';
import logger from '@utils/logger';
import { LambdaService } from '@services/aws/lambda.service';
import { getCountryByCode, getDefaultCountry } from '@constants/countries';
import { getAllCountryCodes, getPriorityCountryCodes } from '@utils/countryUtils';
import { parsePrice, determineLinkType, cleanReferralParameters } from '@utils/priceUtils';
import { extractExternalId } from '@utils/externalIdUtils';

export class GoogleKnowledgePanelEnricher {
    private knex: Knex;
    private lambdaService: LambdaService;

    constructor(knex: Knex) {
        this.knex = knex;
        this.lambdaService = new LambdaService();
    }

    async enrichContent(contentType: string, contentId: number, countryCode: string): Promise<boolean> {
        try {
            // Get content details
            const content = await this.knex(contentType === 'movie' ? 'movies' : 'tv_series')
                .where('id', contentId)
                .first();

            if (!content) {
                logger.error(`${contentType} with ID ${contentId} not found`);
                return false;
            }

            // Get country info
            const countryInfo = getCountryByCode(countryCode) || getDefaultCountry();
            logger.debug(`Using country: ${countryInfo.name} (${countryInfo.code}) with currency: ${countryInfo.currency}`);

            // Create search string
            const searchString = `${content.title || content.name} ${contentType === 'movie' ? 'movie' : 'tv show'}`;

            logger.info(`Starting Google scraper for "${searchString}" in region ${countryCode}`);
            
            // Use LambdaService to invoke the Google scraper
            const result = await this.lambdaService.invokeGoogleScraper(searchString, countryCode);

            logger.trace(result, 'Received scraper result');

            // Save ratings and external IDs
            for (const rating of result.ratings) {
                try {
                    const ratingName = rating.name.toLowerCase();
                    
                    // Handle Google rating
                    if (ratingName === 'google') {
                        const ratingValue = parseFloat(rating.rating);
                        await this.upsertRating(contentType, contentId, 'google', ratingValue);
                        continue;
                    }
                    
                    // Extract external ID from rating URL if available
                    if (rating.link) {
                        const externalIdInfo = extractExternalId(rating.link);
                        if (externalIdInfo) {
                            // Save external ID
                            await this.upsertExternalId(
                                contentType,
                                contentId,
                                externalIdInfo.source,
                                externalIdInfo.externalId,
                                0.9 // High confidence since it's from Google Knowledge Panel
                            );
                        }
                    }
                } catch (error) {
                    logger.error(`Error processing rating for ${contentType} ${contentId}:`, error);
                }
            }

            // Save watch options
            for (const option of result.allWatchOptions) {
                try {
                    if (!option.link) {
                        logger.warn('Skipping watch option without link');
                        continue;
                    }

                    // Extract hostname from URL and clean it
                    let providerName;
                    let logoPath;
                    try {
                        const url = new URL(option.link);
                        providerName = url.hostname.replace('www.', '');
                        logoPath = `/logos/${providerName}.png`;
                    } catch (e) {
                        logger.error(`Invalid URL for watch option: ${option.link}`);
                        continue;
                    }

                    // Find provider by hostname
                    let provider = await this.knex('watch_providers')
                        .where('name', providerName)
                        .first();

                    // If provider doesn't exist, create it
                    if (!provider) {
                        logger.info(`Creating new provider: ${providerName}`);
                        
                        // Get the next available ID
                        const maxIdResult = await this.knex('watch_providers')
                            .max('id as maxId')
                            .first();
                        
                        const nextId = (maxIdResult?.maxId || 0) + 1;
                        
                        // Insert the new provider
                        await this.knex('watch_providers')
                            .insert({
                                id: nextId,
                                name: providerName,
                                logo_path: logoPath,
                                priority: 100  // Default priority
                            });
                        
                        // Fetch the newly created provider
                        provider = await this.knex('watch_providers')
                            .where('id', nextId)
                            .first();
                        
                        logger.debug(`Created new provider: ${providerName} with ID ${nextId}`);
                    }

                    // Parse price information using our utility
                    const priceInfo = parsePrice(option.price);
                    
                    // Determine link type based on price information
                    const linkType = determineLinkType(priceInfo);
                    
                    // Clean URL by removing referral parameters
                    const cleanedUrl = cleanReferralParameters(option.link);
                    
                    // Log if the URL was cleaned
                    if (cleanedUrl !== option.link) {
                        logger.debug(`Cleaned URL for ${provider.name}: ${option.link} -> ${cleanedUrl}`);
                    }
                    
                    // Check if watch link already exists
                    const existingLink = await this.knex('watch_links')
                        .where({
                            content_type: contentType,
                            content_id: contentId,
                            provider_id: provider.id,
                            country_code: countryCode
                        })
                        .first();
                    
                    if (existingLink) {
                        // Update existing link
                        await this.knex('watch_links')
                            .where({
                                content_type: contentType,
                                content_id: contentId,
                                provider_id: provider.id,
                                country_code: countryCode
                            })
                            .update({
                                url: cleanedUrl,
                                link_type: linkType,
                                price: priceInfo.price,
                                raw_price: priceInfo.rawPrice,
                                is_subscription: priceInfo.isSubscription,
                                is_free: priceInfo.isFree,
                                last_verified: new Date()
                            });
                        logger.debug(`Updated watch link for ${contentType} ${contentId} via ${provider.name}`);
                    } else {
                        // Insert new link
                        await this.knex('watch_links')
                            .insert({
                                content_type: contentType,
                                content_id: contentId,
                                provider_id: provider.id,
                                country_code: countryCode,
                                link_type: linkType,
                                url: cleanedUrl,
                                price: priceInfo.price,
                                raw_price: priceInfo.rawPrice,
                                is_subscription: priceInfo.isSubscription,
                                is_free: priceInfo.isFree,
                                currency: countryInfo.currency,
                                last_verified: new Date()
                            });
                        logger.debug(`Inserted watch link for ${contentType} ${contentId} via ${provider.name}`);
                    }
                } catch (error) {
                    logger.error(`Error saving watch link for ${contentType} ${contentId}:`, error);
                }
            }

            logger.info(`Successfully enriched data for ${contentType} ${contentId}`);
            return true;
        } catch (error) {
            logger.error(`Error enriching ${contentType} ${contentId}:`, error);
            return false;
        }
    }

    async processBatch(
        contentType: string,
        contentIds: number[],
        batchSize: number = 5,
        countryCode: string = 'US'
    ): Promise<{ success: number; failed: number }> {
        const results = { success: 0, failed: 0 };

        for (let i = 0; i < contentIds.length; i += batchSize) {
            const batch = contentIds.slice(i, i + batchSize);
            logger.info(`Processing batch ${i / batchSize + 1} of ${Math.ceil(contentIds.length / batchSize)}`);

            for (const contentId of batch) {
                try {
                    const success = await this.enrichContent(contentType, contentId, countryCode);
                    if (success) {
                        results.success++;
                    } else {
                        results.failed++;
                    }
                } catch (error) {
                    logger.error(`Error processing ${contentType} ${contentId}:`, error);
                    results.failed++;
                }
            }
        }

        return results;
    }

    /**
     * Process content across multiple countries
     * @param contentType 'movie' or 'tv'
     * @param contentId Content ID
     * @param countryCodes Optional array of country codes. If not provided, will use all countries.
     * @param batchSize Number of countries to process in parallel
     */
    async processAcrossCountries(
        contentType: string,
        contentId: number,
        countryCodes?: string[],
        batchSize: number = 3
    ): Promise<{ success: number; failed: number }> {
        const results = { success: 0, failed: 0 };
        
        // Use provided country codes or all countries
        const countriesToProcess = countryCodes || getAllCountryCodes();
        
        logger.info(`Starting to process ${contentType} ${contentId} across ${countriesToProcess.length} countries`);
        
        // Process countries in batches to avoid overwhelming the system
        for (let i = 0; i < countriesToProcess.length; i += batchSize) {
            const countryBatch = countriesToProcess.slice(i, i + batchSize);
            logger.debug(`Processing country batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(countriesToProcess.length / batchSize)}`);
            
            // Process each country in the batch
            const batchPromises = countryBatch.map(countryCode => 
                this.enrichContent(contentType, contentId, countryCode)
                    .then(success => {
                        if (success) {
                            results.success++;
                            logger.debug(`Successfully processed ${contentType} ${contentId} for country ${countryCode}`);
                        } else {
                            results.failed++;
                            logger.warn(`Failed to process ${contentType} ${contentId} for country ${countryCode}`);
                        }
                    })
                    .catch(error => {
                        results.failed++;
                        logger.error(`Error processing ${contentType} ${contentId} for country ${countryCode}:`, error);
                    })
            );
            
            // Wait for all countries in this batch to complete
            await Promise.all(batchPromises);
        }
        
        logger.info(`Completed processing ${contentType} ${contentId} across ${countriesToProcess.length} countries. Success: ${results.success}, Failed: ${results.failed}`);
        return results;
    }
    
    /**
     * Process a single content item across priority countries
     * @param contentType 'movie' or 'tv'
     * @param contentId Content ID
     * @param countryCount Number of priority countries to use (default: 5)
     */
    async processPriorityCountries(
        contentType: string,
        contentId: number,
        countryCount: number = 5
    ): Promise<{ success: number; failed: number }> {
        const priorityCountries = getPriorityCountryCodes(countryCount);
        logger.info(`Starting to process ${contentType} ${contentId} across ${priorityCountries.length} priority countries`);
        
        try {
            return await this.processAcrossCountries(
                contentType,
                contentId,
                priorityCountries
            );
        } catch (error) {
            logger.error(`Error processing ${contentType} ${contentId} across priority countries:`, error);
            return { success: 0, failed: 1 };
        }
    }

    private async upsertExternalId(
        contentType: string,
        contentId: number,
        source: string,
        externalId: string,
        confidenceScore: number
    ): Promise<void> {
        try {
            // Check if external ID already exists
            const existingId = await this.knex('external_ids')
                .where({
                    content_type: contentType,
                    content_id: contentId,
                    source: source
                })
                .first();
            
            if (existingId) {
                // Only update if new confidence score is equal or higher
                if (confidenceScore >= (existingId.confidence_score || 0)) {
                    await this.knex('external_ids')
                        .where({
                            content_type: contentType,
                            content_id: contentId,
                            source: source
                        })
                        .update({
                            external_id: externalId,
                            confidence_score: confidenceScore,
                            last_verified: new Date()
                        });
                    logger.debug(`Updated ${source} ID for ${contentType} ${contentId}: ${externalId} (confidence: ${confidenceScore})`);
                } else {
                    logger.debug(`Skipped updating ${source} ID for ${contentType} ${contentId}: existing confidence ${existingId.confidence_score} > new confidence ${confidenceScore}`);
                }
            } else {
                // Insert new ID
                await this.knex('external_ids')
                    .insert({
                        content_type: contentType,
                        content_id: contentId,
                        source: source,
                        external_id: externalId,
                        confidence_score: confidenceScore,
                        last_verified: new Date()
                    });
                logger.debug(`Inserted ${source} ID for ${contentType} ${contentId}: ${externalId} (confidence: ${confidenceScore})`);
            }
        } catch (error) {
            logger.error(`Error saving ${source} ID for ${contentType} ${contentId}:`, error);
            throw error;
        }
    }

    private async upsertRating(
        contentType: string,
        contentId: number,
        source: string,
        rating: number
    ): Promise<void> {
        try {
            // Check if rating already exists
            const existingRating = await this.knex('ratings')
                .where({
                    content_type: contentType,
                    content_id: contentId,
                    source: source
                })
                .first();
            
            if (existingRating) {
                // Update existing rating
                await this.knex('ratings')
                    .where({
                        content_type: contentType,
                        content_id: contentId,
                        source: source
                    })
                    .update({
                        rating: rating,
                        last_updated: new Date()
                    });
                logger.debug(`Updated ${source} rating for ${contentType} ${contentId}`);
            } else {
                // Insert new rating
                await this.knex('ratings')
                    .insert({
                        content_type: contentType,
                        content_id: contentId,
                        source: source,
                        rating: rating,
                        last_updated: new Date()
                    });
                logger.debug(`Inserted ${source} rating for ${contentType} ${contentId}`);
            }
        } catch (error) {
            logger.error(`Error saving ${source} rating for ${contentType} ${contentId}:`, error);
            throw error;
        }
    }
}
