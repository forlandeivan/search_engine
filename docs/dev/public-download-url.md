## Public downloadUrl for attachments

- downloadUrl в событиях `message.created`/`file.uploaded` теперь подписывается на публичном endpoint’е хранилища, если он задан.
- Настройка: `STORAGE_PUBLIC_ENDPOINT` (или `MINIO_PUBLIC_ENDPOINT`) — полный URL публичного S3/MinIO gateway (например, `https://storage.example.com`). Если не задан, используется `MINIO_ENDPOINT` (dev остаётся на внутреннем адресе).
- Для загрузки/удаления по-прежнему используется internal endpoint `MINIO_ENDPOINT`; публичный клиент применяется только для presign.
- TTL ссылки управляется `ATTACHMENT_URL_TTL_SECONDS` (мин 60, макс 3600).
- В no-code payload больше не уходит `storageKey`; остаются только публичные поля файла и `downloadUrl`.
