import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import logger from '@utils/logger';

interface ApiConfig {
    apiGatewayUrl: string;
    stage: string;
    region: string;
    lastUpdated: string;
    endpoints: string[];
}

export class LambdaService {
    private readonly apiEndpoint: string;
    private readonly endpoints: Map<string, string>;

    constructor() {
        this.endpoints = new Map();
        
        // Try to load config from file, fall back to environment variable or default
        try {
            const configPath = path.join(process.cwd(), 'config', 'api.config.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ApiConfig;
                this.apiEndpoint = config.apiGatewayUrl;
                
                // Map endpoints to their names for easy lookup
                if (config.endpoints && config.endpoints.length > 0) {
                    config.endpoints.forEach(endpoint => {
                        const pathParts = endpoint.split('/');
                        const endpointName = pathParts[pathParts.length - 1];
                        this.endpoints.set(endpointName, endpoint);
                    });
                    logger.info(`Loaded ${this.endpoints.size} endpoints from config`);
                }
                
                logger.info(`Using API Gateway URL from config: ${this.apiEndpoint}`);
            } else {
                this.apiEndpoint = process.env.API_GATEWAY_URL || 'https://api.themoviebrowser.com/dev';
                logger.warn('Config file not found, using default or environment variable for API Gateway URL');
            }
        } catch (error) {
            logger.error('Error loading API config:', error);
            this.apiEndpoint = process.env.API_GATEWAY_URL || 'https://api.themoviebrowser.com/dev';
        }
    }

    async invokeGoogleScraper(searchString: string, region: string) {
        try {
            // Use the specific endpoint from the config if available
            const endpoint = this.endpoints.get('google') || `${this.apiEndpoint}/scrape/google`;
            
            const response = await axios.post(endpoint, {
                searchString,
                region,
            });

            return response.data;
        } catch (error) {
            logger.error('Error invoking Google scraper lambda:', error);
            throw error;
        }
    }
} 