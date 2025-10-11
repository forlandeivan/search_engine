CREATE TABLE IF NOT EXISTS "knowledge_bases" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
    "name" text NOT NULL DEFAULT 'База знаний',
    "description" text NOT NULL DEFAULT '',
    "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "knowledge_nodes" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "base_id" varchar NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
    "parent_id" varchar REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE,
    "title" text NOT NULL DEFAULT 'Без названия',
    "type" text NOT NULL DEFAULT 'document' CHECK (type IN ('folder', 'document')),
    "content" text,
    "position" integer NOT NULL DEFAULT 0,
    "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS knowledge_bases_workspace_idx ON knowledge_bases(workspace_id);
CREATE INDEX IF NOT EXISTS knowledge_nodes_base_parent_idx ON knowledge_nodes(base_id, parent_id);
CREATE INDEX IF NOT EXISTS knowledge_nodes_parent_idx ON knowledge_nodes(parent_id);

DO $$
DECLARE
    legacy_table text;
    has_workspace boolean;
    has_title boolean;
    has_content boolean;
    has_parent boolean;
    has_position boolean;
    has_created boolean;
    has_updated boolean;
    has_type boolean;
    has_base_name boolean;
    has_base_description boolean;
    insert_bases_sql text;
    insert_nodes_sql text;
    base_name_expr text;
    base_description_expr text;
    base_created_expr text;
    base_updated_expr text;
    parent_expr text;
    title_expr text;
    content_expr text;
    type_expr text;
    position_expr text;
    created_expr text;
    updated_expr text;
BEGIN
    SELECT to_regclass('public.knowledge_documents')::text INTO legacy_table;
    IF legacy_table IS NULL THEN
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'knowledge_documents' AND column_name = 'workspace_id'
    ) INTO has_workspace;

    IF NOT has_workspace THEN
        RAISE NOTICE 'knowledge_documents table exists without workspace_id column, skipping migration.';
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'knowledge_documents' AND column_name = 'title'
    ) INTO has_title;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'knowledge_documents' AND column_name = 'content'
    ) INTO has_content;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'knowledge_documents' AND column_name = 'parent_id'
    ) INTO has_parent;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'knowledge_documents' AND column_name = 'position'
    ) INTO has_position;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'knowledge_documents' AND column_name = 'created_at'
    ) INTO has_created;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'knowledge_documents' AND column_name = 'updated_at'
    ) INTO has_updated;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'knowledge_documents' AND column_name = 'type'
    ) INTO has_type;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'knowledge_documents' AND column_name = 'base_name'
    ) INTO has_base_name;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'knowledge_documents' AND column_name = 'base_description'
    ) INTO has_base_description;

    base_name_expr := CASE
        WHEN has_base_name THEN format('COALESCE(NULLIF(MAX(kd.base_name::text), %L), %L)', '', 'Импортированная база знаний')
        ELSE format('MAX(%L)', 'Импортированная база знаний')
    END;

    base_description_expr := CASE
        WHEN has_base_description THEN format('COALESCE(MAX(kd.base_description::text), %L)', '')
        ELSE format('MAX(%L)', '')
    END;

    base_created_expr := CASE
        WHEN has_created THEN 'MIN(COALESCE(kd.created_at, CURRENT_TIMESTAMP))'
        ELSE 'MIN(CURRENT_TIMESTAMP)'
    END;

    base_updated_expr := CASE
        WHEN has_updated THEN 'MAX(COALESCE(kd.updated_at, CURRENT_TIMESTAMP))'
        ELSE 'MAX(CURRENT_TIMESTAMP)'
    END;

    insert_bases_sql := format(
        'INSERT INTO knowledge_bases (workspace_id, name, description, created_at, updated_at)
         SELECT src.workspace_id::text,
                src.name,
                src.description,
                src.created_at,
                src.updated_at
         FROM (
           SELECT kd.workspace_id,
                  %s AS name,
                  %s AS description,
                  %s AS created_at,
                  %s AS updated_at
           FROM knowledge_documents kd
           WHERE kd.workspace_id IS NOT NULL
           GROUP BY kd.workspace_id
         ) src
         LEFT JOIN knowledge_bases existing ON existing.workspace_id = src.workspace_id::text
         WHERE existing.id IS NULL;',
        base_name_expr,
        base_description_expr,
        base_created_expr,
        base_updated_expr
    );

    EXECUTE insert_bases_sql;

    parent_expr := CASE
        WHEN has_parent THEN format('NULLIF(kd.parent_id::text, %L)', '')
        ELSE 'NULL'
    END;

    title_expr := CASE
        WHEN has_title THEN format('COALESCE(NULLIF(kd.title::text, %L), %L)', '', 'Без названия')
        ELSE format('%L', 'Без названия')
    END;

    type_expr := CASE
        WHEN has_type THEN 'CASE WHEN kd.type::text = ''folder'' THEN ''folder'' ELSE ''document'' END'
        ELSE format('%L', 'document')
    END;

    content_expr := CASE
        WHEN has_content THEN 'kd.content'
        ELSE 'NULL'
    END;

    position_expr := CASE
        WHEN has_position THEN 'COALESCE(kd.position, 0)'
        ELSE '0'
    END;

    created_expr := CASE
        WHEN has_created THEN 'COALESCE(kd.created_at, CURRENT_TIMESTAMP)'
        ELSE 'CURRENT_TIMESTAMP'
    END;

    updated_expr := CASE
        WHEN has_updated THEN 'COALESCE(kd.updated_at, CURRENT_TIMESTAMP)'
        ELSE 'CURRENT_TIMESTAMP'
    END;

    insert_nodes_sql := format(
        'INSERT INTO knowledge_nodes (id, base_id, parent_id, title, type, content, position, created_at, updated_at)
         SELECT kd.id::text,
                kb.id,
                %s,
                %s,
                %s,
                %s,
                %s,
                %s,
                %s
         FROM knowledge_documents kd
         JOIN knowledge_bases kb ON kb.workspace_id = kd.workspace_id::text
         WHERE kd.workspace_id IS NOT NULL
         ON CONFLICT (id) DO NOTHING;',
        parent_expr,
        title_expr,
        type_expr,
        content_expr,
        position_expr,
        created_expr,
        updated_expr
    );

    EXECUTE insert_nodes_sql;
END $$;
