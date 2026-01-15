-- Добавляем поле context_input_limit в таблицу indexing_rules
ALTER TABLE indexing_rules
ADD COLUMN IF NOT EXISTS context_input_limit integer;

-- Добавляем проверку: context_input_limit должен быть от 100 до 50000 (если не NULL)
ALTER TABLE indexing_rules
ADD CONSTRAINT IF NOT EXISTS indexing_rules_context_input_limit_check 
CHECK (context_input_limit IS NULL OR (context_input_limit >= 100 AND context_input_limit <= 50000));
