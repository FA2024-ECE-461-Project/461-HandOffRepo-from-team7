import winston from 'winston';
import { appendFileSync, existsSync, truncateSync, PathLike } from "fs";
import dotenv from 'dotenv';
dotenv.config();

const LOG_LEVELS = {
  SILENT: 0,
  INFO: 1,
  DEBUG: 2,
};

//clear log file

const logFilePath = process.env.LOG_FILE as PathLike;
truncateSync(logFilePath, 0);
truncateSync('logs/error.log', 0);

function checkLogFilePath() {
  if (!logFilePath || !existsSync(logFilePath)) {
    console.error("LOG_FILE does not exist or is not set");
    process.exit(1);
  }
}

// set log level
// if LOG_LEVEL is not set, default to SILENT
let logLevel = process.env.LOG_LEVEL;
console.log("LOG_LEVEL: ", logLevel);

switch (logLevel) {
  case String(LOG_LEVELS.INFO):
    logLevel = 'info';
    break;
  case String(LOG_LEVELS.DEBUG):
    logLevel = 'debug';
    break;
  default:
    logLevel = 'silent';
}

console.log("LOG_LEVEL: string", logLevel);

const logFile = process.env.LOG_FILE || 'logs/package-evaluator.log';
// Create logger
const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'package-evaluator' },
  transports: [
    //silent console transport
    new winston.transports.Console({ silent: (logLevel === 'silent' || logLevel === 'info' || logLevel === 'debug') }),
    // Write to all logs with level `info` and below to `package-evaluator.log`
    new winston.transports.File({ silent: logLevel === 'silent', filename: logFile , level: 'info' }),
    // Write all logs error (and below) to `error.log`
    new winston.transports.File({ silent: logLevel === 'silent', filename: 'logs/error.log', level: 'debug' }),
  ],
});

export default logger;
