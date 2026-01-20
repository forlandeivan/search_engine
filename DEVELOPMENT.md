# Development Guide

## Dev Server Issues

### Проблема: `npm run dev` падает при каждом изменении файлов

**Причина:** Была некорректная обработка ошибок Vite, которая убивала весь процесс через `process.exit(1)`.

**Исправлено:** 
- Убран `process.exit(1)` из `server/vite.ts`
- Теперь ошибки отображаются в браузере через HMR overlay
- Улучшена конфигурация Vite для стабильного HMR

### Если dev server всё ещё падает:

1. **Проверьте наличие синтаксических ошибок:**
   ```bash
   npm run check
   ```

2. **Проверьте циклические зависимости:**
   - Используйте `madge` для поиска
   ```bash
   npx madge --circular client/src
   ```

3. **Очистите кеш:**
   ```bash
   rm -rf node_modules/.vite
   rm -rf dist
   ```

4. **Memory leaks:**
   Если сервер падает через некоторое время:
   ```bash
   # Увеличьте лимит памяти Node.js
   NODE_OPTIONS="--max-old-space-size=4096" npm run dev
   ```

5. **Отладка:**
   ```bash
   # Включите подробное логирование Vite
   DEBUG=vite:* npm run dev
   ```

## Hot Module Replacement (HMR)

### Как это работает:
- Vite работает в middleware mode внутри Express сервера
- При изменении файлов Vite отправляет обновления через WebSocket
- Браузер автоматически обновляет изменённые модули без full reload

### Если HMR не работает:
1. Проверьте что WebSocket соединение установлено (в DevTools → Network → WS)
2. Проверьте firewall/proxy настройки
3. Убедитесь что `hmr: { overlay: true }` включен в `vite.config.ts`

## TypeScript

### Incremental Compilation
TypeScript incremental compilation включена в `tsconfig.json`:
- Кеш хранится в `node_modules/typescript/tsbuildinfo`
- Ускоряет повторные проверки типов

### Type Checking
```bash
# Проверка типов без эмита
npm run check

# Watch mode
npx tsc --watch --noEmit
```

## Performance Tips

1. **Используйте динамические импорты** для больших компонентов:
   ```typescript
   const HeavyComponent = lazy(() => import('./HeavyComponent'));
   ```

2. **Игнорируйте большие файлы** в `server.watch.ignored`

3. **Используйте Code Splitting** - Vite делает это автоматически

## Common Issues

### Port Already in Use
```bash
# Найти процесс на порту 5000
lsof -ti:5000 | xargs kill -9  # Mac/Linux
netstat -ano | findstr :5000   # Windows
```

### Module Not Found
```bash
# Переустановите зависимости
rm -rf node_modules package-lock.json
npm install
```

### Strange TypeScript Errors
```bash
# Перезапустите TypeScript Server
# В VSCode: Ctrl+Shift+P → "TypeScript: Restart TS Server"
```
