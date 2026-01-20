import { describe, it, expect, beforeEach } from "vitest";
import { ExpressionInterpreter } from "../server/services/expression-interpreter";
import { createFieldToken, createFunctionToken, createTextToken } from "../shared/json-import";

describe("ExpressionInterpreter", () => {
  let interpreter: ExpressionInterpreter;

  beforeEach(() => {
    interpreter = new ExpressionInterpreter();
  });

  describe("evaluate", () => {
    it("should evaluate text token", () => {
      const result = interpreter.evaluate(
        [createTextToken("Hello World")],
        {}
      );
      expect(result.success).toBe(true);
      expect(result.value).toBe("Hello World");
    });

    it("should evaluate field token", () => {
      const result = interpreter.evaluate(
        [createFieldToken("title")],
        { title: "My Title" }
      );
      expect(result.success).toBe(true);
      expect(result.value).toBe("My Title");
    });

    it("should evaluate nested field", () => {
      const result = interpreter.evaluate(
        [createFieldToken("metadata.author")],
        { metadata: { author: "John" } }
      );
      expect(result.value).toBe("John");
    });

    it("should return empty string for missing field", () => {
      const result = interpreter.evaluate(
        [createFieldToken("missing")],
        {}
      );
      expect(result.value).toBe("");
    });

    it("should evaluate NewGUID function", () => {
      const result = interpreter.evaluate(
        [createFunctionToken("NewGUID")],
        {}
      );
      expect(result.success).toBe(true);
      expect(result.value).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it("should concatenate multiple tokens", () => {
      const result = interpreter.evaluate(
        [
          createFieldToken("title"),
          createTextToken(" - "),
          createFieldToken("category"),
        ],
        { title: "Hello", category: "World" }
      );
      expect(result.value).toBe("Hello - World");
    });

    it("should handle unknown function", () => {
      const result = interpreter.evaluate(
        [createFunctionToken("Unknown")],
        {}
      );
      expect(result.success).toBe(false);
      expect(result.errors).toContain("Unknown function: Unknown");
    });
  });

  describe("applyMapping", () => {
    it("should apply full mapping config", () => {
      const config = {
        version: 2 as const,
        id: { expression: [createFieldToken("id")] },
        title: { expression: [createFieldToken("name")] },
        content: { expression: [createFieldToken("text")], required: true },
        metadata: [
          { key: "author", expression: [createFieldToken("author")] },
        ],
      };

      const record = {
        id: "123",
        name: "Test Doc",
        text: "Content here",
        author: "John",
      };

      const result = interpreter.applyMapping(config, record);
      
      expect(result.id).toBe("123");
      expect(result.title).toBe("Test Doc");
      expect(result.content).toBe("Content here");
      expect(result.metadata).toEqual({ author: "John" });
    });

    it("should use NewGUID for id", () => {
      const config = {
        version: 2 as const,
        id: { expression: [createFunctionToken("NewGUID")] },
        title: { expression: [createFieldToken("name")] },
        content: { expression: [createFieldToken("text")], required: true },
        metadata: [],
      };

      const result = interpreter.applyMapping(config, { name: "Test", text: "Content" });
      
      expect(result.id).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it("should combine title fields", () => {
      const config = {
        version: 2 as const,
        title: { 
          expression: [
            createFieldToken("title"),
            createTextToken(" - "),
            createFieldToken("category"),
          ]
        },
        content: { expression: [createFieldToken("text")], required: true },
        metadata: [],
      };

      const record = {
        title: "Doc",
        category: "News",
        text: "Content",
      };

      const result = interpreter.applyMapping(config, record);
      expect(result.title).toBe("Doc - News");
    });

    it("should use fallback title when expression is empty", () => {
      const config = {
        version: 2 as const,
        title: { expression: [] },
        content: { expression: [createFieldToken("text")], required: true },
        titleFallback: "first_line" as const,
        metadata: [],
      };

      const record = {
        text: "First line\nSecond line",
      };

      const result = interpreter.applyMapping(config, record);
      expect(result.title).toBe("First line");
    });
  });
});
