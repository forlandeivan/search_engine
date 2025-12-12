# ASR usage entrypoints (Yandex async STT)

- Основной сценарий: POST `/api/chat/transcribe` (multer in-memory) принимает аудио, создаёт `transcript` (сохраняет `source_file_id` = objectKey в S3) и `asrExecution` (via `asrExecutionLogService.createExecution`) и вызывает `yandexSttAsyncService.startAsyncTranscription`.
- STT провайдер: Yandex async API. Файл загружается в Object Storage через `yandexObjectStorageService.uploadAudioFile` (ключ `stt-audio/...`, размер доступен как `audioBuffer.length`). В кэше `operationsCache` храним `operationId`, `chatId`, `transcriptId`, `executionId`.
- Статусы: `/api/chat/transcribe/operations/:operationId` и `/api/chat/transcribe/complete/:operationId` читают `yandexSttAsyncService.getOperationStatus` (pull из Yandex) и обновляют transcript/message + пишут события в `asrExecutionLogService`.
- Workspace берётся из чата (`chat.workspaceId`), далее несётся в `asrExecution` и transcript.
- Фактическая длительность аудио сейчас нигде не сохраняется: нет поля duration в transcript/chat message, в `asrExecution` есть `durationMs`, но он не устанавливается; ответ Yandex async API не содержит длительность. Есть только `file.size` (байты) из загрузки.
- “Момент истины” для usage нужно добавить: либо измерять длительность при приёме (ffprobe/metadata) и сохранять в `asrExecution.durationMs`, либо читать длительность из стороннего STT ответа (если появится). Инкремент usage вшивать в момент завершения транскрибации (complete) после фиксации фактической длительности.
