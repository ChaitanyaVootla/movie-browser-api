import * as fs from 'fs';
import * as path from 'path';
import logger from '@utils/logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import { LambdaService } from '@services/aws/lambda.service';

const execPromise = promisify(exec);

interface ApiConfig {
    apiGatewayUrl: string;
    stage: string;
    region: string;
    lastUpdated: string;
    endpoints: string[];
}

async function runServerlessInfo(): Promise<string> {
    logger.info('Running serverless info command...');
    try {
        const { stdout } = await execPromise('npx serverless info');
        return stdout;
    } catch (error) {
        if (error instanceof Error) {
            logger.error('Failed to run serverless info command:', error.message);
            throw error;
        } else {
            logger.error('Failed to run serverless info command: Unknown error');
            throw new Error('Failed to run serverless info command');
        }
    }
}

async function parseServerlessInfo(infoOutput: string): Promise<ApiConfig> {
    logger.info('Parsing serverless info output...');
    
    // Extract relevant information using regex
    const stageMatch = infoOutput.match(/stage:\s*([^\s]+)/i);
    const regionMatch = infoOutput.match(/region:\s*([^\s]+)/i);
    const endpointMatch = infoOutput.match(/endpoint:\s*([^\n]+)/i);
    
    // Extract all functions that have HTTP endpoints
    const functionMatches = [...infoOutput.matchAll(/functions:\s+([^\n]+)\s+([^\n]+)\s+([^\n]+)/g)];
    
    // Create endpoints array by parsing function endpoints
    const endpoints: string[] = [];
    for (const match of functionMatches) {
        if (match[2] && match[2].includes('http')) {
            endpoints.push(match[2].trim());
        }
        if (match[3] && match[3].includes('http')) {
            endpoints.push(match[3].trim());
        }
    }
    
    // If no endpoints found in functions section, use the main endpoint
    if (endpoints.length === 0 && endpointMatch && endpointMatch[1]) {
        endpoints.push(endpointMatch[1].trim());
    }
    
    return {
        apiGatewayUrl: endpointMatch ? endpointMatch[1].trim() : '',
        stage: stageMatch ? stageMatch[1].trim() : 'dev',
        region: regionMatch ? regionMatch[1].trim() : '',
        lastUpdated: new Date().toISOString(),
        endpoints: endpoints
    };
}

async function updateApiConfig() {
    try {
        logger.info('Updating API Gateway configuration...');
        
        // Run serverless info and get the output
        const serverlessInfoOutput = await runServerlessInfo();
        
        // Save raw output to file
        const rawOutputPath = path.join(process.cwd(), 'config', 'serverless-info.txt');
        
        // Create config directory if it doesn't exist
        const configDir = path.join(process.cwd(), 'config');
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        
        // Write raw output to file
        fs.writeFileSync(rawOutputPath, serverlessInfoOutput);
        logger.info(`Serverless info output saved to ${rawOutputPath}`);
        
        // Parse the output to generate config
        const config = await parseServerlessInfo(serverlessInfoOutput);
        
        // If parsing failed to get API Gateway URL, fall back to hard-coded values
        if (!config.apiGatewayUrl) {
            logger.warn('Could not parse API Gateway URL from serverless info, using fallback values');
            config.apiGatewayUrl = 'https://zjb4vpykla.execute-api.ap-south-2.amazonaws.com/dev';
            config.stage = 'dev';
            config.region = 'ap-south-2';
            config.endpoints = [
                'https://zjb4vpykla.execute-api.ap-south-2.amazonaws.com/dev/scrape',
                'https://zjb4vpykla.execute-api.ap-south-2.amazonaws.com/dev/scrape/google'
            ];
        }

        logger.debug('Generated config:', config);

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