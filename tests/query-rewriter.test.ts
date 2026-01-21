/**
 * Unit tests for Query Rewriter
 */

import { describe, it, expect } from "vitest";
import { needsRewriting } from "../server/query-rewriter";
import type { ChatConversationMessage } from "../server/chat-service";

describe("needsRewriting", () => {
  const emptyHistory: ChatConversationMessage[] = [];
  
  const sampleHistory: ChatConversationMessage[] = [
    { role: "user", content: "Какие правила освидетельствования работников?" },
    { role: "assistant", content: "Согласно постановлению, освидетельствование проводится на добровольной основе..." },
  ];

  it("should return false for empty history", () => {
    expect(needsRewriting("Какой-то вопрос", emptyHistory)).toBe(false);
  });

  it("should return false for self-contained queries", () => {
    expect(needsRewriting("Какие документы нужны для регистрации?", sampleHistory)).toBe(false);
    expect(needsRewriting("Что такое ЕГРН?", sampleHistory)).toBe(false);
  });

  it("should return true for contextual patterns: 'об этом'", () => {
    expect(needsRewriting("А что об этом говорит закон?", sampleHistory)).toBe(true);
  });

  it("should return true for contextual patterns: 'подробнее'", () => {
    expect(needsRewriting("Расскажи подробнее", sampleHistory)).toBe(true);
    expect(needsRewriting("Подробнее про пункт 2", sampleHistory)).toBe(true);
  });

  it("should return true for contextual patterns: 'исключения'", () => {
    expect(needsRewriting("А какие исключения?", sampleHistory)).toBe(true);
  });

  it("should return true for contextual patterns: 'какие ещё'", () => {
    expect(needsRewriting("Какие ещё документы?", sampleHistory)).toBe(true);
  });

  it("should return true for contextual patterns: 'пункт N'", () => {
    expect(needsRewriting("Подробнее про пункт 3", sampleHistory)).toBe(true);
    expect(needsRewriting("Что в пункте 2?", sampleHistory)).toBe(true);
  });

  it("should return true for contextual patterns: pronouns", () => {
    expect(needsRewriting("Как получить выписку из этого?", sampleHistory)).toBe(true);
    expect(needsRewriting("А что об этом?", sampleHistory)).toBe(true);
  });

  it("should return true for queries starting with conjunctions", () => {
    expect(needsRewriting("А какие документы?", sampleHistory)).toBe(true);
    expect(needsRewriting("И что дальше?", sampleHistory)).toBe(true);
  });

  it("should return true for short queries without nouns", () => {
    expect(needsRewriting("А что?", sampleHistory)).toBe(true);
    expect(needsRewriting("Как?", sampleHistory)).toBe(true);
  });

  it("should return false for short queries with nouns", () => {
    expect(needsRewriting("Документы?", sampleHistory)).toBe(false);
    expect(needsRewriting("Регистрация?", sampleHistory)).toBe(false);
  });

  it("should handle edge cases", () => {
    expect(needsRewriting("", sampleHistory)).toBe(false);
    expect(needsRewriting("   ", sampleHistory)).toBe(false);
  });
});
