# Storage usage entrypoints

- Клиент MinIO: `server/minio-client.ts` + обёртка `server/workspace-storage-service.ts`. Бакет на workspace (`workspaces.storageBucket`, имя `ws-<workspace-id-normalized>`), префиксы ограничены `icons/`, `files/`, `attachments/`.
- Точки upload/delete: `uploadWorkspaceFile`/`deleteWorkspaceFile` и низкоуровневые `putObject`/`deleteObject` в `workspace-storage-service.ts`. Здесь удобнее всего вшивать инкремент storage_usage после успешной загрузки/удаления (размер берём из `file.size`/`buffer.length` или HEAD/метаданных).
- Из текущих фич MinIO реально использует только `workspace-icon-service.ts` (ключ `icons/icon.<ext>`, размер есть в multer `file.size`). Другие категории под `files/` и `attachments/` ещё не заведены.
- Отдельный S3-клиент для STT: `yandex-object-storage-service.ts` + `yandex-stt-async-service.ts` (bucket из настроек провайдера, не workspace-специфичный). При загрузке аудио есть `audioBuffer.length`, ключ кладём в `transcripts.source_file_id`, workspaceId есть в транскрипте/чате — пригодится, если решим учитывать этот объём в storage usage.
- Workspace вычисляется однозначно по бакету (MinIO путь) или по бизнес-сущности: иконки — workspaceId из запроса; STT — workspaceId из транскрипта/чата, objectKey хранится в транскрипте.
