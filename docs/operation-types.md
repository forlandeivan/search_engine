# OperationType и ожидаемый контекст

| OperationType | Описание | expectedCost | meta.scenario / поля |
| --- | --- | --- | --- |
| LLM_REQUEST | Вызов LLM (чат, skill, pipeline, генерация) | tokens | meta.llm.scenario: chat/skill/pipeline/generation; provider/model |
| EMBEDDINGS | Построение эмбеддингов | tokens/bytes/objects | meta.embeddings.scenario: document_vectorization/query_embedding; provider/model; objects.parentId=collection |
| ASR_TRANSCRIPTION | Создание ASR-задачи | seconds | meta.asr.mediaType: audio/video; provider/model; durationSeconds |
| STORAGE_UPLOAD | Загрузка файла в хранилище | bytes | meta.storage: fileName/mimeType/category(sizeBytes) |
| CREATE_SKILL | Создание навыка | objects | meta.objects.entityType: skill |
| CREATE_KNOWLEDGE_BASE | Создание базы знаний/коллекции | objects | meta.objects.entityType: knowledge_base |
| CREATE_ACTION | Создание action | objects | meta.objects.entityType: action; parentId=skill |
| INVITE_WORKSPACE_MEMBER | Приглашение/добавление участника | objects | meta.objects.entityType: member |
