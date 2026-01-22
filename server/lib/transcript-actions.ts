/**
 * Transcript Actions Module
 * 
 * Functions for running transcript actions (auto-actions, manual actions)
 * with LLM processing and transcript updates.
 */

import { storage } from '../storage';
import { createLogger } from './logger';
import { fetchAccessToken } from '../llm-access-token';
import { skillExecutionLogService } from '../skill-execution-log-context';
import { mergeLlmRequestConfig } from '../search/utils';
import { executeLlmCompletion } from '../llm-client';
import { isLlmPromptDebugEnabled } from '../llm-debug-config';
import { resolveLlmConfigForAction } from '../llm-config-resolver';
import type { SkillDto, ActionDto } from '@shared/skills';
import type { ActionPlacement } from '@shared/schema';

const logger = createLogger('transcript-actions');

// ============================================================================
// Types
// ============================================================================

export type AutoActionRunPayload = {
  userId: string;
  skill: SkillDto;
  action: ActionDto;
  placement: ActionPlacement;
  transcriptId?: string | null;
  transcriptText: string;
  context: Record<string, unknown>;
};

export type AutoActionRunResult = {
  text: string;
  applied: boolean;
  appliedChanges: unknown;
};

// ============================================================================
// Main Function
// ============================================================================

export async function runTranscriptActionCommon(payload: AutoActionRunPayload): Promise<AutoActionRunResult> {
  const actionStartTime = Date.now();
  const LLM_DEBUG_PROMPTS = isLlmPromptDebugEnabled();
  const truncate = (value: string, limit = 2000) =>
    typeof value === 'string' && value.length > limit ? `${value.slice(0, limit)}…` : value;
  
  const { userId, skill, action, transcriptId, transcriptText, context } = payload;
  const logContext = {
    workspaceId: skill.workspaceId,
    skillId: skill.id,
    userId,
    chatId: typeof context?.chatId === 'string' ? context.chatId : undefined,
    actionId: action.id,
    target: action.target,
    placement: payload.placement,
    transcriptId: transcriptId ?? undefined,
    trigger: typeof context?.trigger === 'string' ? context.trigger : undefined,
  };
  
  logger.info({
    ...logContext,
    actionLabel: action.label,
    textLength: transcriptText.length,
    inputType: action.inputType,
    outputMode: action.outputMode,
  }, '[ACTION-START] Starting transcript action');

  logger.info({
    ...logContext,
    transcriptTextPreview: transcriptText.substring(0, 200),
    transcriptTextLength: transcriptText.length,
    promptLength: action.promptTemplate.length,
  }, '[ACTION-INPUT] Input text for action');

  const executionMetadata = {
    trigger: logContext.trigger ?? 'manual_action',
    actionId: logContext.actionId,
    target: logContext.target,
    placement: logContext.placement,
    transcriptId: logContext.transcriptId,
  };
  
  const execution = await skillExecutionLogService.startExecution({
    workspaceId: logContext.workspaceId,
    skillId: logContext.skillId,
    userId: logContext.userId ?? null,
    chatId: logContext.chatId ?? null,
    userMessageId: null,
    source: 'workspace_skill',
    metadata: executionMetadata as Record<string, unknown>,
  });
  const executionId = execution?.id ?? null;

  const prompt = action.promptTemplate.replace(/{{\s*text\s*}}/gi, transcriptText);
  const resolvedProvider = await resolveLlmConfigForAction(skill, action);
  const modelOverride = skill.modelId && skill.modelId.trim().length > 0 ? skill.modelId.trim() : null;
  const llmProvider = modelOverride ? { ...resolvedProvider, model: modelOverride } : resolvedProvider;
  const requestConfig = mergeLlmRequestConfig(llmProvider);

  const messages: Array<{ role: string; content: string }> = [];
  if (requestConfig.systemPrompt && requestConfig.systemPrompt.trim()) {
    messages.push({ role: 'system', content: requestConfig.systemPrompt.trim() });
  }
  messages.push({ role: 'user', content: prompt });

  const requestBody: Record<string, unknown> = {
    [requestConfig.modelField]: llmProvider.model,
    [requestConfig.messagesField]: messages,
  };

  if (requestConfig.temperature !== undefined) {
    requestBody.temperature = requestConfig.temperature;
  }
  if (requestConfig.maxTokens !== undefined) {
    requestBody.max_tokens = requestConfig.maxTokens;
  }

  const accessToken = await fetchAccessToken(llmProvider);
  let completion: Awaited<ReturnType<typeof executeLlmCompletion>>;
  
  logger.info({
    ...logContext,
    model: llmProvider.model,
    provider: llmProvider.name,
    elapsed: Date.now() - actionStartTime,
  }, '[ACTION-LLM-START] Calling LLM for action');

  const llmStartTime = Date.now();
  try {
    completion = await executeLlmCompletion(llmProvider, accessToken, requestBody);
    
    logger.info({
      ...logContext,
      model: llmProvider.model,
      usageTokens: completion.usageTokens,
      llmTime: Date.now() - llmStartTime,
      elapsed: Date.now() - actionStartTime,
      responseLength: completion.answer?.length || 0,
      responsePreview: completion.answer?.substring(0, 200),
    }, '[ACTION-LLM-DONE] LLM call completed');

    if (executionId) {
      await skillExecutionLogService.logStepSuccess({
        executionId,
        type: 'CALL_LLM',
        input: {
          model: llmProvider.model,
          provider: llmProvider.name,
          actionId: action.id,
          target: action.target,
          placement: payload.placement,
          ...(LLM_DEBUG_PROMPTS
            ? {
                prompt: truncate(prompt, 2000),
                systemPrompt: truncate(requestConfig.systemPrompt ?? '', 1200),
              }
            : {}),
        },
        output: {
          usageTokens: completion.usageTokens ?? null,
        },
      });
    }
  } catch (llmError) {
    if (executionId) {
      await skillExecutionLogService.logStepError({
        executionId,
        type: 'CALL_LLM',
        input: {
          model: llmProvider.model,
          provider: llmProvider.name,
          actionId: action.id,
          target: action.target,
          placement: payload.placement,
          ...(LLM_DEBUG_PROMPTS
            ? {
                prompt: truncate(prompt, 2000),
                systemPrompt: truncate(requestConfig.systemPrompt ?? '', 1200),
              }
            : {}),
        },
        errorMessage: llmError instanceof Error ? llmError.message : String(llmError),
      });
      await skillExecutionLogService.markExecutionFailed(executionId);
    }
    throw llmError;
  }
  
  const llmText = completion.answer;

  // Apply only replace_text for transcript
  if (action.outputMode !== 'replace_text') {
    logger.warn({ actionId: action.id, outputMode: action.outputMode }, 'Output mode not supported for auto-action');
    if (executionId) {
      await skillExecutionLogService.markExecutionSuccess(executionId);
    }
    return { text: llmText, applied: false, appliedChanges: null };
  }
  
  if (!transcriptId) {
    logger.warn('transcriptId missing, skipping application');
    if (executionId) {
      await skillExecutionLogService.markExecutionSuccess(executionId);
    }
    return { text: llmText, applied: false, appliedChanges: null };
  }
  
  const transcript = await storage.getTranscriptById?.(transcriptId);
  if (!transcript || transcript.workspaceId !== skill.workspaceId) {
    logger.warn({ transcriptId, workspaceId: skill.workspaceId }, 'Transcript not found or wrong workspace');
    if (executionId) {
      await skillExecutionLogService.markExecutionSuccess(executionId);
    }
    return { text: llmText, applied: false, appliedChanges: null };
  }

  let newText = llmText;
  if (action.inputType === 'selection') {
    if (typeof context.selectionText === 'string' && context.selectionText.length > 0) {
      const full = transcript.fullText ?? '';
      newText = full.replace(context.selectionText, llmText);
      logger.info({
        ...logContext,
        originalFullTextLength: full.length,
        selectionLength: context.selectionText.length,
        llmTextLength: llmText.length,
        newTextLength: newText.length,
      }, '[ACTION-REPLACE] Replaced selection in transcript');
    }
  } else {
    logger.info({
      ...logContext,
      inputType: action.inputType,
      originalTranscriptLength: transcript.fullText?.length || 0,
      llmTextLength: llmText.length,
    }, '[ACTION-REPLACE] Full text replacement mode');
  }

  logger.info({
    ...logContext,
    beforeUpdateLength: transcript.fullText?.length || 0,
    afterUpdateLength: newText.length,
    textTruncated: newText.length < llmText.length,
  }, '[ACTION-UPDATE] About to update transcript in database');

  await storage.updateTranscript(transcriptId, {
    fullText: newText,
    lastEditedByUserId: userId,
  });
  
  // Verify the update
  const verifyTranscript = await storage.getTranscriptById?.(transcriptId);
  logger.info({
    ...logContext,
    savedLength: verifyTranscript?.fullText?.length || 0,
    expectedLength: newText.length,
    lengthMismatch: (verifyTranscript?.fullText?.length || 0) !== newText.length,
  }, '[ACTION-UPDATE-VERIFY] Verified transcript after update');
  
  if (executionId) {
    await skillExecutionLogService.markExecutionSuccess(executionId);
  }

  logger.info({
    ...logContext,
    applied: true,
    resultLength: llmText.length,
    finalTranscriptLength: verifyTranscript?.fullText?.length || 0,
    totalTime: Date.now() - actionStartTime,
  }, '[ACTION-SUCCESS] Transcript action applied successfully');

  return {
    text: llmText,
    applied: true,
    appliedChanges: {
      type: 'transcript_replace',
      transcriptId,
    },
  };
}
