import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger';

interface ApiConfig {
    apiGatewayUrl: string;
    stage: string;
    region: string;
    lastUpdated: string;
}

export class LambdaService {
    private readonly apiEndpoint: string;

    constructor() {
        // Try to load config from file, fall back to environment variable or default
        try {
            const configPath = path.join(process.cwd(), 'config', 'api.config.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ApiConfig;
                this.apiEndpoint = config.apiGatewayUrl;
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
            const response = await axios.post(`${this.apiEndpoint}/scrape/google`, {
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