ALTER TABLE "sites" ADD COLUMN "search_settings" jsonb NOT NULL DEFAULT '{
  "fts": {"titleBoost": 15, "contentBoost": 8},
  "similarity": {"titleThreshold": 0.02, "contentThreshold": 0.015, "titleWeight": 10, "contentWeight": 5},
  "wordSimilarity": {"titleThreshold": 0.15, "contentThreshold": 0.1, "titleWeight": 8, "contentWeight": 4},
  "ilike": {"titleBoost": 5, "contentBoost": 2.5},
  "collectionSearch": {"similarityTitleThreshold": 0.2, "similarityContentThreshold": 0.1, "ftsMatchBonus": 0.5, "similarityWeight": 0.3},
  "fallback": {"ftsTitleBoost": 10, "ftsContentBoost": 5, "ilikeTitleBoost": 3, "ilikeContentBoost": 1.5}
}'::jsonb;
