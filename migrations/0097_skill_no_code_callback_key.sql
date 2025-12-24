ALTER TABLE skills
    ADD COLUMN no_code_callback_key text;

CREATE UNIQUE INDEX skills_no_code_callback_key_idx
    ON skills (no_code_callback_key);
