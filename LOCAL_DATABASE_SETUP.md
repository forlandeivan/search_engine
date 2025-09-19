
# Локальная настройка PostgreSQL для Tilda Search Bot

## Предварительные требования

1. Установите PostgreSQL (версия 12 или выше)
2. Убедитесь, что PostgreSQL запущен
3. Установите Node.js и npm
4. Клонируйте проект и установите зависимости

## Шаги настройки

### 1. Создание базы данных и пользователя

```sql
-- Подключитесь к PostgreSQL как суперпользователь
sudo -u postgres psql

-- Создайте пользователя
CREATE USER tilda_search_user WITH PASSWORD 'secure_password_123';

-- Создайте базу данных
CREATE DATABASE tilda_search_db OWNER tilda_search_user;

-- Дайте привилегии пользователю
GRANT ALL PRIVILEGES ON DATABASE tilda_search_db TO tilda_search_user;
GRANT USAGE, CREATE ON SCHEMA public TO tilda_search_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO tilda_search_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO tilda_search_user;

-- Выйдите из psql
\q
```

### 2. Применение схемы

```bash
# Примените схему базы данных
psql -U tilda_search_user -d tilda_search_db -f database_schema.sql
```

### 3. Настройка переменных окружения

Создайте файл `.env` в корне проекта:

```env
# Локальная база данных PostgreSQL
DATABASE_URL="postgresql://tilda_search_user:secure_password_123@localhost:5432/tilda_search_db"

# Настройки приложения
NODE_ENV=development
PORT=5000

# Токен администратора для экстренной остановки краулингов
ADMIN_TOKEN="your_admin_token_here"
```

### 4. Установка зависимостей и запуск

```bash
# Установите зависимости
npm install

# Проверьте TypeScript
npm run check

# Примените миграции базы данных (если используете Drizzle ORM)
npm run db:push

# Запустите проект в режиме разработки
npm run dev
```

### 5. Проверка подключения

Проверьте, что база данных работает корректно:

```bash
# Подключитесь к базе данных
psql -U tilda_search_user -d tilda_search_db

# Проверьте таблицы
\dt

# Проверьте расширения
\dx

# Проверьте пример данных
SELECT * FROM sites LIMIT 5;
SELECT COUNT(*) FROM pages;

# Выйдите
\q
```

### 6. Тестирование API

После запуска сервера на `http://localhost:5000`:

```bash
# Проверьте статус базы данных
curl http://localhost:5000/api/health/db

# Проверьте список сайтов
curl http://localhost:5000/api/sites

# Проверьте статистику
curl http://localhost:5000/api/stats

# Тестовый поиск
curl "http://localhost:5000/api/search?q=example"
```

## Структура базы данных

### Основные таблицы:

1. **sites** - Конфигурации сайтов для краулинга
   - `id` (UUID) - уникальный идентификатор
   - `url` (text) - URL сайта для краулинга
   - `crawl_depth` (integer) - глубина краулинга (по умолчанию 3)
   - `follow_external_links` (boolean) - следовать ли внешним ссылкам
   - `crawl_frequency` (text) - частота краулинга: manual/hourly/daily/weekly
   - `exclude_patterns` (jsonb) - JSON массив паттернов исключения
   - `status` (text) - статус: idle/crawling/completed/failed
   - `last_crawled`, `next_crawl` (timestamp) - время последнего и следующего краулинга
   - `error` (text) - сообщение об ошибке
   - `created_at`, `updated_at` (timestamp) - временные метки

2. **pages** - Проиндексированный контент страниц
   - `id` (UUID) - уникальный идентификатор
   - `site_id` (UUID) - ссылка на сайт
   - `url` (text) - URL страницы
   - `title`, `content`, `meta_description` (text) - контент страницы
   - `status_code` (integer) - HTTP статус код
   - `last_crawled` (timestamp) - время последнего краулинга
   - `content_hash` (text) - хеш контента для отслеживания изменений
   - `search_vector_*` (tsvector) - векторы для полнотекстового поиска
   - `created_at`, `updated_at` (timestamp) - временные метки

3. **search_index** - Оптимизированный поисковый индекс
   - `id` (UUID) - уникальный идентификатор
   - `page_id` (UUID) - ссылка на страницу
   - `term` (text) - поисковый термин
   - `frequency`, `position` (integer) - частота и позиция термина
   - `relevance` (double precision) - релевантность термина

4. **users** - Пользователи (для будущих админ функций)
   - `id` (UUID) - уникальный идентификатор
   - `username` (text) - имя пользователя
   - `password` (text) - хешированный пароль

### Ключевые особенности:

- **Full-Text Search**: PostgreSQL tsvector для быстрого поиска
- **Typo Tolerance**: pg_trgm расширение для поиска с опечатками
- **Weighted Search**: Веса A (title), B (meta), C (content), D (partial matches)
- **Configurable Fuzzy Weights**: jsonb-колонка `search_settings` в таблице `sites` позволяет менять пороги `pg_trgm`, вес ts_rank и бонусы для ILIKE через админку
- **Automatic Triggers**: Автоматическое обновление search vectors при изменении контента
- **Multi-language Support**: Поддержка английского и других языков
- **Performance Optimized**: Индексы для быстрого поиска и сортировки

## Работа с краулингом

### Добавление сайта для краулинга:

```bash
curl -X POST http://localhost:5000/api/sites \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "crawlDepth": 3,
    "followExternalLinks": false,
    "crawlFrequency": "manual",
    "excludePatterns": ["*.pdf", "*.zip"]
  }'
```

### Запуск краулинга:

```bash
# Начать краулинг сайта
curl -X POST http://localhost:5000/api/sites/{site_id}/crawl

# Остановить краулинг
curl -X POST http://localhost:5000/api/sites/{site_id}/stop-crawl

# Экстренная остановка всех краулингов
curl -X POST http://localhost:5000/api/emergency/stop-all-crawls \
  -H "x-admin-token: your_admin_token_here"
```

## Резервное копирование и восстановление

```bash
# Создать бэкап
pg_dump -U tilda_search_user -d tilda_search_db --no-password > backup_$(date +%Y%m%d_%H%M%S).sql

# Восстановить из бэкапа
psql -U tilda_search_user -d tilda_search_db < backup_20241201_120000.sql
```

## Оптимизация производительности

### Рекомендуемые настройки PostgreSQL:

```sql
-- Увеличить лимиты для работы с полнотекстовым поиском
SET work_mem = '256MB';
SET maintenance_work_mem = '512MB';
SET shared_buffers = '128MB';

-- Регулярное обслуживание
VACUUM ANALYZE;
REINDEX DATABASE tilda_search_db;

-- Проверка размера индексов
SELECT schemaname, tablename, indexname, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes 
ORDER BY pg_relation_size(indexrelid) DESC;
```

### Мониторинг производительности:

```sql
-- Статистика по таблицам
SELECT schemaname, tablename, n_tup_ins, n_tup_upd, n_tup_del, n_live_tup, n_dead_tup
FROM pg_stat_user_tables;

-- Статистика по индексам
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes;

-- Медленные запросы (требует включения log_min_duration_statement)
SELECT query, calls, total_time, mean_time, rows
FROM pg_stat_statements 
ORDER BY total_time DESC LIMIT 10;
```

## Устранение неполадок

### Проблемы с подключением:
1. Убедитесь, что PostgreSQL запущен: `sudo systemctl status postgresql`
2. Проверьте настройки в `pg_hba.conf` для локальных подключений
3. Убедитесь, что DATABASE_URL правильно настроен в `.env`

### Проблемы с краулингом:
1. Проверьте логи в консоли: `npm run dev`
2. Проверьте статус сайтов: `curl http://localhost:5000/api/stats`
3. Используйте экстренную остановку при зависании краулинга

### Проблемы с поиском:
1. Убедитесь, что расширения pg_trgm и unaccent установлены
2. Проверьте, что search vectors обновляются автоматически
3. Проверьте индексы: `\d+ pages` в psql

## Миграции

При изменении схемы создавайте миграции:

```bash
# Создать новую миграцию
npm run db:push

# Или создать SQL файл миграции вручную
# migrations/001_add_new_feature.sql
```

Этот локальный setup полностью совместим с production версией и позволяет тестировать все функции поискового бота локально.
