import type { IndexingWizardConfig, SchemaFieldConfig } from "@shared/knowledge-base-indexing";
import type { IndexingRulesDto } from "@shared/indexing-rules";
import { DEFAULT_SCHEMA_FIELDS } from "@shared/knowledge-base-indexing";
import { parseTemplateToExpression } from "./template-parser";

/**
 * Преобразует политику индексации базы знаний в конфиг визарда
 */
export function convertPolicyToWizardConfig(policy: {
  embeddingsProvider: string;
  embeddingsModel: string;
  chunkSize: number;
  chunkOverlap: number;
  defaultSchema?: Array<{
    name: string;
    type: string;
    isArray: boolean;
    template: string;
  }>;
}): IndexingWizardConfig {
  const schemaFields: SchemaFieldConfig[] = (policy.defaultSchema ?? []).map((field, index) => ({
    id: `field-${index}`,
    name: field.name,
    type: field.type as SchemaFieldConfig["type"],
    isArray: field.isArray,
    expression: parseTemplateToExpression(field.template),
    isEmbeddingField: field.name === "text",
  }));

  // Если нет поля text, добавляем его
  if (!schemaFields.find((f) => f.name === "text")) {
    schemaFields.unshift(DEFAULT_SCHEMA_FIELDS[0]);
  }

  return {
    chunkSize: policy.chunkSize,
    chunkOverlap: policy.chunkOverlap,
    embeddingsProvider: policy.embeddingsProvider,
    embeddingsModel: policy.embeddingsModel,
    topK: 6, // Дефолтное значение
    relevanceThreshold: 0.5,
    maxContextTokens: 3000,
    citationsEnabled: true,
    schemaFields,
  };
}

/**
 * Преобразует глобальные правила индексации в конфиг визарда
 */
export function convertRulesToWizardConfig(rules: IndexingRulesDto): IndexingWizardConfig {
  return {
    chunkSize: rules.chunkSize,
    chunkOverlap: rules.chunkOverlap,
    embeddingsProvider: rules.embeddingsProvider,
    embeddingsModel: rules.embeddingsModel,
    topK: rules.topK,
    relevanceThreshold: rules.relevanceThreshold,
    maxContextTokens: rules.maxContextTokens ?? 3000,
    citationsEnabled: rules.citationsEnabled,
    schemaFields: DEFAULT_SCHEMA_FIELDS, // Дефолтная схема
  };
}
