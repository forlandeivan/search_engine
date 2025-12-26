# Standard vs KB/Nocode Mode — Contract

## Определения
- **Standard**: `skill.mode = "llm"` (значение по умолчанию). Источник знаний — только файлы навыка, проиндексированные в workspace-коллекцию; retrieval-параметры — из админских правил (indexing rules). KB/collections/legacy rag\_* игнорируются.
- **KB/Nocode**: `skill.mode = "rag"` (или отдельный KB-флаг, если появится). Включает старый RAG/KB-пайплайн (`chat-rag.ts`, KB UI/эндпоинты).

## Точки ветвления
- Backend:
  - `server/skill-type.ts:isRagSkill` — RAG включается только при `mode === "rag"`.
  - `server/skills.ts` — default `mode = "llm"`, стандартные навыки сохраняются без rag/KB, KB-связи очищаются.
  - `server/chat-service.ts` — standard чат использует admin indexing rules + workspace+skill фильтр; KB/RAG не вызывается.
  - `server/skill-file-ingestion-jobs.ts` — эмбеддинги только из админки; ragConfig навыка не используется.
  - `server/routes.ts` — KB/RAG endpoint `/collections/search/rag` не влияет на standard-поток.
- Frontend:
  - KB UI скрыт из стандартной формы навыка (SkillSettingsPage) и из сайдбара; KnowledgeBase routes за guarded флагом `VITE_ENABLE_KB`.
  - Типы `Skill`/`SkillPayload` допускают `ragConfig` как optional/null, стандартный UI его не использует.

## Правило разделения
- Standard — дефолт. Всё, что относится к RAG/KB, доступно только если навык явно `mode="rag"` (или будущий KB-flag true). Наличие legacy rag\_*/KB полей в данных не переключает режим.

## Проверка
- Standard skill (mode=llm): сохраняется без rag/KB, чат/ingestion работают через admin rules; KB маршруты не отображаются и редиректят, если KB выключен.
- KB skill (mode=rag): доступен старый KB/RAG функционал (при включённом флаге/UI).

