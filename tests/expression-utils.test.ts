import { describe, it, expect } from "vitest";
import {
  expressionToDisplayString,
  isExpressionEmpty,
  addTokenToExpression,
  removeTokenFromExpression,
  normalizeExpression,
  evaluateExpressionClient,
} from "../client/src/lib/expression-utils";
import {
  createFieldToken,
  createFunctionToken,
  createTextToken,
  type MappingExpression,
} from "../shared/json-import";

describe("expression-utils", () => {
  describe("expressionToDisplayString", () => {
    it("should convert field token to display string", () => {
      const expr: MappingExpression = [createFieldToken("title")];
      expect(expressionToDisplayString(expr)).toBe("{{ title }}");
    });

    it("should convert function token to display string", () => {
      const expr: MappingExpression = [createFunctionToken("NewGUID")];
      expect(expressionToDisplayString(expr)).toBe("{{ NewGUID() }}");
    });

    it("should convert text token to display string", () => {
      const expr: MappingExpression = [createTextToken("Hello")];
      expect(expressionToDisplayString(expr)).toBe("Hello");
    });

    it("should combine multiple tokens", () => {
      const expr: MappingExpression = [
        createFieldToken("title"),
        createTextToken(" - "),
        createFieldToken("category"),
      ];
      expect(expressionToDisplayString(expr)).toBe("{{ title }} - {{ category }}");
    });
  });

  describe("isExpressionEmpty", () => {
    it("should return true for empty expression", () => {
      expect(isExpressionEmpty([])).toBe(true);
    });

    it("should return true for expression with only empty text tokens", () => {
      const expr: MappingExpression = [
        createTextToken(""),
        createTextToken("   "),
      ];
      expect(isExpressionEmpty(expr)).toBe(true);
    });

    it("should return false for expression with field token", () => {
      const expr: MappingExpression = [createFieldToken("title")];
      expect(isExpressionEmpty(expr)).toBe(false);
    });

    it("should return false for expression with non-empty text", () => {
      const expr: MappingExpression = [createTextToken("Hello")];
      expect(isExpressionEmpty(expr)).toBe(false);
    });
  });

  describe("addTokenToExpression", () => {
    it("should add token to end when position not specified", () => {
      const expr: MappingExpression = [createFieldToken("title")];
      const result = addTokenToExpression(expr, createTextToken(" - "));
      expect(result).toEqual([
        createFieldToken("title"),
        createTextToken(" - "),
      ]);
    });

    it("should add token at specified position", () => {
      const expr: MappingExpression = [
        createFieldToken("title"),
        createFieldToken("category"),
      ];
      const result = addTokenToExpression(expr, createTextToken(" - "), 1);
      expect(result).toEqual([
        createFieldToken("title"),
        createTextToken(" - "),
        createFieldToken("category"),
      ]);
    });
  });

  describe("removeTokenFromExpression", () => {
    it("should remove token at specified index", () => {
      const expr: MappingExpression = [
        createFieldToken("title"),
        createTextToken(" - "),
        createFieldToken("category"),
      ];
      const result = removeTokenFromExpression(expr, 1);
      expect(result).toEqual([
        createFieldToken("title"),
        createFieldToken("category"),
      ]);
    });

    it("should return empty array when removing from single token expression", () => {
      const expr: MappingExpression = [createFieldToken("title")];
      const result = removeTokenFromExpression(expr, 0);
      expect(result).toEqual([]);
    });
  });

  describe("normalizeExpression", () => {
    it("should merge adjacent text tokens", () => {
      const expr: MappingExpression = [
        createTextToken("Hello"),
        createTextToken(" "),
        createTextToken("World"),
      ];
      const result = normalizeExpression(expr);
      expect(result).toEqual([createTextToken("Hello World")]);
    });

    it("should remove empty text tokens", () => {
      const expr: MappingExpression = [
        createFieldToken("title"),
        createTextToken(""),
        createFieldToken("category"),
      ];
      const result = normalizeExpression(expr);
      expect(result).toEqual([
        createFieldToken("title"),
        createFieldToken("category"),
      ]);
    });

    it("should preserve non-text tokens", () => {
      const expr: MappingExpression = [
        createFieldToken("title"),
        createTextToken(" - "),
        createFunctionToken("NewGUID"),
      ];
      const result = normalizeExpression(expr);
      expect(result).toEqual(expr);
    });
  });

  describe("evaluateExpressionClient", () => {
    it("should evaluate field token", () => {
      const expr: MappingExpression = [createFieldToken("title")];
      const record = { title: "My Title" };
      expect(evaluateExpressionClient(expr, record)).toBe("My Title");
    });

    it("should evaluate nested field", () => {
      const expr: MappingExpression = [createFieldToken("metadata.author")];
      const record = { metadata: { author: "John" } };
      expect(evaluateExpressionClient(expr, record)).toBe("John");
    });

    it("should return empty string for missing field", () => {
      const expr: MappingExpression = [createFieldToken("missing")];
      const record = {};
      expect(evaluateExpressionClient(expr, record)).toBe("");
    });

    it("should concatenate tokens", () => {
      const expr: MappingExpression = [
        createFieldToken("title"),
        createTextToken(" - "),
        createFieldToken("category"),
      ];
      const record = { title: "Hello", category: "World" };
      expect(evaluateExpressionClient(expr, record)).toBe("Hello - World");
    });

    it("should show placeholder for NewGUID function", () => {
      const expr: MappingExpression = [createFunctionToken("NewGUID")];
      const record = {};
      expect(evaluateExpressionClient(expr, record)).toBe("[UUID будет сгенерирован]");
    });

    it("should show placeholder for unknown function", () => {
      const expr: MappingExpression = [createFunctionToken("Unknown")];
      const record = {};
      expect(evaluateExpressionClient(expr, record)).toBe("[Unknown()]");
    });

    it("should handle null and undefined values", () => {
      const expr: MappingExpression = [createFieldToken("value")];
      expect(evaluateExpressionClient(expr, { value: null })).toBe("");
      expect(evaluateExpressionClient(expr, { value: undefined })).toBe("");
    });

    it("should convert non-string values to string", () => {
      const expr: MappingExpression = [createFieldToken("count")];
      expect(evaluateExpressionClient(expr, { count: 42 })).toBe("42");
      expect(evaluateExpressionClient(expr, { count: true })).toBe("true");
    });
  });
});
