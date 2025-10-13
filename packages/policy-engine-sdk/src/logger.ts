/**
 * Log levels supported by the SDK
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Logger function signature for SDK logging
 * @param level - The log level
 * @param message - The log message
 * @param context - Optional structured context for the log entry
 */
export type Logger = (level: LogLevel, message: string, context?: Record<string, unknown>) => void;

/**
 * Default logger that outputs to console
 * Uses appropriate console methods for each log level
 */
export const defaultLogger: Logger = (level: LogLevel, message: string, context?: Record<string, unknown>) => {
  const contextStr = context ? ` ${JSON.stringify(context)}` : "";
  if (level === "debug") console.debug(message + contextStr);
  else if (level === "info") console.info(message + contextStr);
  else if (level === "warn") console.warn(message + contextStr);
  else if (level === "error") console.error(message + contextStr);
};

/**
 * Silent logger that suppresses all log output
 * Useful for production environments or testing where log noise is unwanted
 */
export const silentLogger: Logger = () => {
  // No-op
};
