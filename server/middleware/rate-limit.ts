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
 * Limit: 100 requests per 15 minutes
 * Disabled in test mode (CI environment variable set)
 */
export const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
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
 * Limit: 5 requests per 15 minutes (brute-force protection)
 * Disabled in test mode (CI environment variable set)
 */
export const authLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login requests per windowMs
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
 * Limit: 3 requests per hour (spam protection)
 * Disabled in test mode (CI environment variable set)
 */
export const authRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 registration requests per hour
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
 * Limit: 20 requests per minute (protect LLM resources)
 */
export const llmChatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // Limit each IP to 20 LLM requests per minute
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
 * Limit: 10 requests per minute (protect RAG resources)
 */
export const knowledgeRagLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 RAG requests per minute
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
