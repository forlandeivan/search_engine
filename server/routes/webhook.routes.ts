/**
 * Webhook Routes Module
 * 
 * Handles webhook operations:
 * - POST /api/webhook/send-json - Send JSON to external webhook
 */

import { Router } from 'express';
import { z } from 'zod';
import { createLogger } from '../lib/logger';

const logger = createLogger('webhook');

export const webhookRouter = Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const sendJsonToWebhookSchema = z.object({
  webhookUrl: z.string().url(),
  payload: z.string(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /send-json
 * Send JSON payload to external webhook
 */
webhookRouter.post('/send-json', async (req, res) => {
  try {
    const { webhookUrl, payload } = sendJsonToWebhookSchema.parse(req.body);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(payload);
    } catch (error) {
      return res.status(400).json({
        error: 'Некорректный JSON',
        details: error instanceof Error ? error.message : String(error),
      });
    }

    if (!Array.isArray(parsedJson)) {
      return res.status(400).json({
        error: 'JSON должен быть массивом чанков',
      });
    }

    const webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsedJson),
    });

    const responseText = await webhookResponse.text();

    if (!webhookResponse.ok) {
      return res.status(webhookResponse.status).json({
        error: 'Удалённый вебхук вернул ошибку',
        status: webhookResponse.status,
        details: responseText,
      });
    }

    res.json({
      message: 'JSON успешно отправлен на вебхук',
      status: webhookResponse.status,
      response: responseText,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Некорректные данные запроса',
        details: error.issues,
      });
    }

    logger.error({ error }, 'Ошибка пересылки JSON на вебхук');
    res.status(500).json({ error: 'Не удалось отправить JSON на вебхук' });
  }
});

export default webhookRouter;
