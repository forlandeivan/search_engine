# Миграции: как прогонять вручную

- Всегда смотри `.env` для `DATABASE_URL`.
- На Windows запускай `psql` с полным путём, например:
  ```
  $env:DATABASE_URL="postgresql://user:pass@host:5432/db"
  & "C:\Program Files\PostgreSQL\17\bin\psql.exe" "$env:DATABASE_URL" -f migrations/<file>.sql
  ```
- Проверка: `psql "$env:DATABASE_URL" -c "\d <table>"`.
