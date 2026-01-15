-- Добавляем поле max_context_tokens в таблицу indexing_rules с DEFAULT значением
ALTER TABLE indexing_rules
ADD COLUMN IF NOT EXISTS max_context_tokens integer NOT NULL DEFAULT 3000;

-- Добавляем проверку: max_context_tokens должен быть от 500 до 20000
ALTER TABLE indexing_rules
ADD CONSTRAINT IF NOT EXISTS indexing_rules_max_context_tokens_check 
CHECK (max_context_tokens >= 500 AND max_context_tokens <= 20000);
