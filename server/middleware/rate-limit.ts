/**
 * Rate Limiting Middleware
 * 
 * Protects API endpoints from abuse and DDoS attacks.
 * Different limits for different endpoint groups based on their sensitivity.
 */

import rateLimit from 'express-rate-limit';
import { createLogger } from '../lib/logger';

const logger = createLogger('rate-limit');

/**
 * General API rate limiter
 * Limit: 100000 requests per 15 minutes (increased 1000x for development)
 * Disabled in test mode (CI environment variable set)
 */
export const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100000, // Limit each IP to 100000 requests per windowMs (1000x increase)
  skip: () => !!process.env.CI, // Skip rate limiting in CI/test environment
  message: {
    error: 'Превышен лимит запросов. Попробуйте позже.',
    retryAfter: '15 минут',
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    logger.warn({
      ip: req.ip,
      path: req.path,
      method: req.method,
    }, 'Rate limit exceeded for general API');
    res.status(429).json({
      error: 'Превышен лимит запросов. Попробуйте позже.',
      retryAfter: '15 минут',
    });
  },
});

/**
 * Authentication endpoint rate limiter
 * Limit: 5000 requests per 15 minutes (increased 1000x for development)
 * Disabled in test mode (CI environment variable set)
 */
export const authLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // Limit each IP to 5000 login requests per windowMs (1000x increase)
  skip: () => !!process.env.CI, // Skip rate limiting in CI/test environment
  message: {
    error: 'Слишком много попыток входа. Попробуйте через 15 минут.',
    retryAfter: '15 минут',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
  handler: (req, res) => {
    logger.warn({
      ip: req.ip,
      path: req.path,
    }, 'Rate limit exceeded for authentication');
    res.status(429).json({
      error: 'Слишком много попыток входа. Попробуйте через 15 минут.',
      retryAfter: '15 минут',
    });
  },
});

/**
 * Registration endpoint rate limiter
 * Limit: 3000 requests per hour (increased 1000x for development)
 * Disabled in test mode (CI environment variable set)
 */
export const authRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3000, // Limit each IP to 3000 registration requests per hour (1000x increase)
  skip: () => !!process.env.CI, // Skip rate limiting in CI/test environment
  message: {
    error: 'Превышен лимит регистраций. Попробуйте через час.',
    retryAfter: '1 час',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({
      ip: req.ip,
      path: req.path,
    }, 'Rate limit exceeded for registration');
    res.status(429).json({
      error: 'Превышен лимит регистраций. Попробуйте через час.',
      retryAfter: '1 час',
    });
  },
});

/**
 * LLM/chat endpoint rate limiter
 * Limit: 20000 requests per minute (increased 1000x for development)
 */
export const llmChatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20000, // Limit each IP to 20000 LLM requests per minute (1000x increase)
  message: {
    error: 'Превышен лимит запросов к LLM. Подождите немного.',
    retryAfter: '1 минута',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({
      ip: req.ip,
      path: req.path,
      method: req.method,
    }, 'Rate limit exceeded for LLM/chat');
    res.status(429).json({
      error: 'Превышен лимит запросов к LLM. Подождите немного.',
      retryAfter: '1 минута',
    });
  },
});

/**
 * Knowledge base RAG endpoint rate limiter
 * Limit: 10000 requests per minute (increased 1000x for development)
 */
export const knowledgeRagLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10000, // Limit each IP to 10000 RAG requests per minute (1000x increase)
  message: {
    error: 'Превышен лимит запросов к базе знаний. Подождите немного.',
    retryAfter: '1 минута',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({
      ip: req.ip,
      path: req.path,
      method: req.method,
    }, 'Rate limit exceeded for knowledge base RAG');
    res.status(429).json({
      error: 'Превышен лимит запросов к базе знаний. Подождите немного.',
      retryAfter: '1 минута',
    });
  },
});
