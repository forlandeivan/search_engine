/**
 * Backward-compat re-export.
 *
 * IMPORTANT: There is a `utils/` folder with the canonical form schema.
 * This file exists only to keep legacy imports (`./SkillsPage/utils`) working.
 */

// IMPORTANT: There is also `utils.ts` (this file) and `utils/` folder.
// Some bundlers can resolve `./utils` to this file, creating a cycle.
// Always export explicitly from the folder index.
export * from "./utils/index";
