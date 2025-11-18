CREATE OR REPLACE FUNCTION sanitized_chunk_text(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
           regexp_replace(
             unaccent(COALESCE($1, '')),
             E'[-_]+',
             ' ',
             'g'
           ),
           '[^[:alnum:]\s]+',
           ' ',
           'g'
         );
$$;
