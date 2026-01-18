/**
 * Utilities for filter operations in VectorCollectionDetailPage
 */

import { excludedPointKeys, filterOperatorSymbols } from "../constants";
import type { CollectionPoint, FilterCombineMode, FilterCondition } from "../types";

export function generateConditionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `condition-${Math.random().toString(36).slice(2, 10)}`;
}

export function collectNestedFields(
  source: Record<string, unknown>,
  prefix: string,
  accumulator: Set<string>,
) {
  Object.entries(source).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    accumulator.add(path);

    if (value && typeof value === "object" && !Array.isArray(value)) {
      collectNestedFields(value as Record<string, unknown>, path, accumulator);
    }
  });
}

export function getAvailableFieldPaths(points: CollectionPoint[]): string[] {
  const fields = new Set<string>();

  points.forEach((point) => {
    if (point.payload) {
      collectNestedFields(point.payload, "", fields);
    }

    Object.entries(point).forEach(([key, value]) => {
      if (excludedPointKeys.has(key) || value === undefined || value === null) {
        return;
      }

      fields.add(key);
    });
  });

  return Array.from(fields).sort((a, b) => a.localeCompare(b, "ru"));
}

export function parseFilterPrimitive(rawValue: string): string | number | boolean {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return "";
  }

  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === "true";
  }

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }

  return trimmed;
}

export function buildFilterPayload(
  conditions: FilterCondition[],
  combineMode: FilterCombineMode,
): Record<string, unknown> {
  const meaningfulConditions = conditions.filter((condition) => condition.field.trim().length > 0);

  if (meaningfulConditions.length === 0) {
    throw new Error("Добавьте хотя бы одно условие фильтра.");
  }

  const positive: Array<Record<string, unknown>> = [];
  const negative: Array<Record<string, unknown>> = [];

  for (const condition of meaningfulConditions) {
    const field = condition.field.trim();
    const value = condition.value.trim();

    switch (condition.operator) {
      case "eq": {
        const parsedValue = parseFilterPrimitive(value);
        positive.push({ key: field, match: { value: parsedValue } });
        break;
      }
      case "neq": {
        const parsedValue = parseFilterPrimitive(value);
        negative.push({ key: field, match: { value: parsedValue } });
        break;
      }
      case "contains": {
        if (!value) {
          throw new Error("Укажите значение для оператора 'Содержит'.");
        }
        positive.push({ key: field, match: { text: value } });
        break;
      }
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const parsedNumber = Number(value);
        if (Number.isNaN(parsedNumber)) {
          throw new Error("Для сравнений укажите числовое значение.");
        }

        const rangeKey = condition.operator === "gt"
          ? "gt"
          : condition.operator === "gte"
            ? "gte"
            : condition.operator === "lt"
              ? "lt"
              : "lte";

        positive.push({ key: field, range: { [rangeKey]: parsedNumber } });
        break;
      }
      default:
        throw new Error("Неизвестный оператор фильтра.");
    }
  }

  const filter: Record<string, unknown> = {};

  if (combineMode === "and" && positive.length > 0) {
    filter.must = positive;
  }

  if (combineMode === "or" && positive.length > 0) {
    filter.should = positive;
    filter.min_should = { conditions: positive, min_count: 1 };
  }

  if (negative.length > 0) {
    filter.must_not = negative;
  }

  if (!filter.must && !filter.should && !filter.must_not) {
    throw new Error("Не удалось построить фильтр. Проверьте условия.");
  }

  return filter;
}

export function describeFilterConditions(conditions: FilterCondition[], combineMode: FilterCombineMode): string {
  const meaningful = conditions.filter((condition) => condition.field.trim().length > 0);

  if (meaningful.length === 0) {
    return "Фильтр не задан";
  }

  const separator = combineMode === "and" ? " ∧ " : " ∨ ";

  return meaningful
    .map((condition) => {
      const valuePart = condition.value.trim() ? condition.value.trim() : "∅";
      return `${condition.field} ${filterOperatorSymbols[condition.operator]} ${valuePart}`;
    })
    .join(separator);
}
