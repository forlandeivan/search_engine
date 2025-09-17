
# Локальная настройка PostgreSQL для Tilda Search Bot

## Предварительные требования

1. Установите PostgreSQL (версия 12 или выше)
2. Убедитесь, что PostgreSQL запущен
3. Создайте базу данных и пользователя

## Шаги настройки

### 1. Создание базы данных и пользователя

```sql
-- Подключитесь к PostgreSQL как суперпользователь
sudo -u postgres psql

-- Создайте пользователя
CREATE USER tilda_search_user WITH PASSWORD 'your_password_here';

-- Создайте базу данных
CREATE DATABASE tilda_search_db OWNER tilda_search_user;

-- Дайте привилегии пользователю
GRANT ALL PRIVILEGES ON DATABASE tilda_search_db TO tilda_search_user;
GRANT USAGE, CREATE ON SCHEMA public TO tilda_search_user;

-- Выйдите из psql
\q
```

### 2. Применение схемы

```bash
# Примените схему базы данных
psql -U tilda_search_user -d tilda_search_db -f database_schema.sql
```

### 3. Настройка переменных окружения

Создайте файл `.env.local` в корне проекта:

```env
# Локальная база данных PostgreSQL
DATABASE_URL="postgresql://tilda_search_user:your_password_here@localhost:5432/tilda_search_db"

# Другие переменные окружения
NODE_ENV=development
PORT=5000
```

### 4. Проверка подключения

Проверьте, что база данных работает корректно:

```bash
# Подключитесь к базе данных
psql -U tilda_search_user -d tilda_search_db

# Проверьте таблицы
\dt

# Проверьте расширения
\dx

# Выйдите
\q
```

## Структура базы данных

### Таблицы:

1. **sites** - Конфигурации сайтов для краулинга
   - id, url, crawl_depth, follow_external_links
   - crawl_frequency, exclude_patterns, status
   - last_crawled, next_crawl, error
   - timestamps

2. **pages** - Проиндексированный контент страниц
   - id, site_id, url, title, content
   - meta_description, status_code, last_crawled
   - search vectors (title, content, combined)
   - timestamps

3. **search_index** - Оптимизированный поисковый индекс
   - id, page_id, term, frequency, position
   - relevance, timestamp

4. **users** - Пользователи (для будущих админ функций)
   - id, username, password

### Ключевые особенности:

- **Full-Text Search**: Использует PostgreSQL tsvector для быстрого поиска
- **Typo Tolerance**: pg_trgm расширение для поиска с опечатками
- **Weighted Search**: Разные веса для title (A), meta (B), content (C)
- **Automatic Triggers**: Автоматическое обновление search vectors
- **Russian Language Support**: Настроен для работы с русским языком

## Миграции

Если вы вносите изменения в схему, создавайте миграции в папке `migrations/`:

```sql
-- Пример миграции
-- migrations/001_add_new_column.sql
ALTER TABLE pages ADD COLUMN new_field text;
```

## Бэкап и восстановление

```bash
# Создать бэкап
pg_dump -U tilda_search_user -d tilda_search_db > backup.sql

# Восстановить из бэкапа
psql -U tilda_search_user -d tilda_search_db < backup.sql
```

## Оптимизация производительности

Схема уже включает оптимальные индексы для:
- Поиска по URL и site_id
- Full-text поиска
- Similarity поиска (опечатки)
- Сортировки по дате

Рекомендуется периодически выполнять:
```sql
VACUUM ANALYZE;
REINDEX DATABASE tilda_search_db;
```
