/**
 * KnowledgeBasePage Module Index
 * 
 * This module contains the KnowledgeBasePage component and its subcomponents.
 * The page is being progressively decomposed from a 4000+ line monolith.
 * 
 * Current status:
 * - types.ts: Common types extracted
 * - components/QuickSearchTrigger.tsx: Quick search trigger extracted
 * 
 * TODO: Continue decomposition:
 * - Extract TreeMenu component
 * - Extract document tree hooks
 * - Extract chunking operations hooks
 * - Extract indexing status components
 */

// Re-export the main page component from the original file
// This maintains backward compatibility during migration
export { default } from "../KnowledgeBasePage";

// Export types for use in other parts of the application
export * from "./types";

// Export components
export * from "./components";
