import { pino } from 'pino'
import { config, isProduction } from './config.js'

// JSON logs in production (collected by Docker / CloudWatch); pretty in dev.
export const logger = pino({
  level: config.LOG_LEVEL,
  ...(isProduction
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
  redact: {
    // Never let credentials or session material reach the logs.
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.secret', '*.credentials'],
    censor: '[redacted]',
  },
})
