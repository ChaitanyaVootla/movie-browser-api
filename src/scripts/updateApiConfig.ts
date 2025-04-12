import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { logger } from '../utils/logger';

interface ApiConfig {
    apiGatewayUrl: string;
    stage: string;
    region: string;
    lastUpdated: string;
    endpoints: string[];
}

function parseServerlessOutput(output: string): any {
    logger.debug('Raw serverless output:', output);

    const lines = output.split('\n');
    const info: any = {
        stage: '',
        region: '',
        endpoints: [],
        serviceEndpoint: ''
    };

    let currentSection = '';

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        logger.debug('Processing line:', trimmedLine);

        // Parse based on line content
        if (trimmedLine.startsWith('stage:')) {
            info.stage = trimmedLine.split(':')[1].trim();
            logger.debug('Found stage:', info.stage);
        } else if (trimmedLine.startsWith('region:')) {
            info.region = trimmedLine.split(':')[1].trim();
            logger.debug('Found region:', info.region);
        } else if (trimmedLine === 'endpoints:') {
            currentSection = 'endpoints';
        } else if (currentSection === 'endpoints' && trimmedLine.includes(' - ')) {
            const parts = trimmedLine.split(' - ');
            if (parts.length > 1) {
                const endpoint = parts[1].trim();
                info.endpoints.push(endpoint);
                logger.debug('Found endpoint:', endpoint);

                // If this is the first endpoint, use it as the base URL
                if (info.endpoints.length === 1) {
                    info.serviceEndpoint = endpoint.split('/').slice(0, 3).join('/');
                    logger.debug('Set service endpoint:', info.serviceEndpoint);
                }
            }
        }
    }

    logger.debug('Parsed serverless info:', info);

    if (!info.serviceEndpoint && info.endpoints.length === 0) {
        throw new Error('Could not find API Gateway URL in serverless output. Available info: ' + JSON.stringify(info, null, 2));
    }

    return {
        ...info,
        apiGatewayUrl: info.serviceEndpoint
    };
}

async function getServerlessInfo(): Promise<any> {
    // Use direct path to serverless
    logger.debug('Running serverless info command...');

    const serverlessPath = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'serverless.cmd' : 'serverless');
    
    if (!fs.existsSync(serverlessPath)) {
        throw new Error(`Serverless binary not found at ${serverlessPath}. Please run npm install first.`);
    }

    logger.debug('Using serverless at:', serverlessPath);

    const result = spawnSync(serverlessPath, ['info', '--verbose'], {
        encoding: 'utf8',
        shell: true,
        cwd: process.cwd(),
        windowsHide: true,
        env: {
            ...process.env,
            FORCE_COLOR: '0'
        }
    });

    if (result.error) {
        logger.error('Serverless command error:', result.error);
        throw new Error(`Failed to execute serverless command: ${result.error.message}`);
    }

    // Log the raw output for debugging
    const stdout = result.stdout.replace(/\r\n/g, '\n').trim();
    logger.debug('Raw stdout:', stdout);
    logger.debug('Raw stderr:', result.stderr);
    logger.debug('Command status:', result.status);

    if (result.status !== 0) {
        logger.error('Serverless command failed:', result.stderr);
        throw new Error(`Serverless command failed with status ${result.status}. Error: ${result.stderr}`);
    }

    try {
        return parseServerlessOutput(stdout);
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to parse serverless output: ${error.message}`);
        }
        throw new Error('Failed to parse serverless output');
    }
}

async function updateApiConfig() {
    try {
        logger.info('Fetching API Gateway configuration from Serverless...');
        
        const info = await getServerlessInfo();
        
        const config: ApiConfig = {
            apiGatewayUrl: info.apiGatewayUrl,
            stage: info.stage || 'dev',
            region: info.region || 'ap-south-2',
            lastUpdated: new Date().toISOString(),
            endpoints: info.endpoints || []
        };

        logger.debug('Generated config:', config);

        // Create config directory if it doesn't exist
        const configDir = path.join(process.cwd(), 'config');
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }

        // Write config to file
        const configPath = path.join(configDir, 'api.config.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        logger.info(`API configuration updated successfully at ${configPath}`);
        logger.info(`API Gateway URL: ${config.apiGatewayUrl}`);
        logger.info(`Available endpoints: ${config.endpoints.join(', ')}`);
        
        return config;
    } catch (error) {
        if (error instanceof Error) {
            logger.error('Failed to update API configuration:', error.message);
            throw error;
        } else {
            logger.error('Failed to update API configuration: Unknown error');
            throw new Error('Unknown error occurred while updating API configuration');
        }
    }
}

// Only run if this is the main module
if (require.main === module) {
    updateApiConfig().catch((error) => {
        logger.error('Script failed:', error);
        process.exit(1);
    });
}

// Export for use in other modules
export { updateApiConfig }; 