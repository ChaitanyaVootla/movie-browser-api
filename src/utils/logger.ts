/**
 * Simple logger utility for the application
 */

// Log levels
export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
}

// Default log level
let currentLogLevel = LogLevel.INFO;

/**
 * Set the current log level
 * @param level The log level to set
 */
export function setLogLevel(level: LogLevel): void {
    currentLogLevel = level;
}

/**
 * Check if a log level should be displayed based on the current log level
 * @param level The log level to check
 * @returns boolean Whether the log level should be displayed
 */
function shouldLog(level: LogLevel): boolean {
    const levels = Object.values(LogLevel);
    const currentIndex = levels.indexOf(currentLogLevel);
    const levelIndex = levels.indexOf(level);
    return levelIndex >= currentIndex;
}

/**
 * Format a log message
 * @param level The log level
 * @param message The message to log
 * @param data Optional data to include in the log
 * @returns string The formatted log message
 */
function formatLogMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    let logMessage = `[${timestamp}] [${level}] ${message}`;

    if (data) {
        if (data instanceof Error) {
            logMessage += `\n${data.stack || data.message}`;
        } else if (typeof data === 'object') {
            try {
                logMessage += `\n${JSON.stringify(data, null, 2)}`;
            } catch (e) {
                logMessage += `\n[Object]`;
            }
        } else {
            logMessage += `\n${data}`;
        }
    }

    return logMessage;
}

/**
 * Log a debug message
 * @param message The message to log
 * @param data Optional data to include in the log
 */
export function debug(message: string, data?: any): void {
    if (shouldLog(LogLevel.DEBUG)) {
        console.debug(formatLogMessage(LogLevel.DEBUG, message, data));
    }
}

/**
 * Log an info message
 * @param message The message to log
 * @param data Optional data to include in the log
 */
export function info(message: string, data?: any): void {
    if (shouldLog(LogLevel.INFO)) {
        console.info(formatLogMessage(LogLevel.INFO, message, data));
    }
}

/**
 * Log a warning message
 * @param message The message to log
 * @param data Optional data to include in the log
 */
export function warn(message: string, data?: any): void {
    if (shouldLog(LogLevel.WARN)) {
        console.warn(formatLogMessage(LogLevel.WARN, message, data));
    }
}

/**
 * Log an error message
 * @param message The message to log
 * @param data Optional data to include in the log
 */
export function error(message: string, data?: any): void {
    if (shouldLog(LogLevel.ERROR)) {
        console.error(formatLogMessage(LogLevel.ERROR, message, data));
    }
}

// Export a default logger object
export const logger = {
    debug,
    info,
    warn,
    error,
    setLogLevel,
};
