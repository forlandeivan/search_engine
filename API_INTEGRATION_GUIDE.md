
# API Поискового Движка - Полная Инструкция для Интеграции с Тильдой

## Обзор Системы

Наш поисковый движок использует **PostgreSQL Full-Text Search** с поддержкой:
- ✅ Полнотекстовый поиск с ранжированием результатов
- ✅ Поиск с опечатками через trigram similarity
- ✅ Морфологический анализ (склонения, множественное число)
- ✅ Поиск по заголовкам с повышенным приоритетом
- ✅ Автоматическая индексация контента сайтов

### Базовый URL
```
https://ваш-домен.replit.dev/api
```

## Основной API Endpoint для Поиска

### GET /api/search

**Описание:** Выполняет умный поиск по всем проиндексированным сайтам

**Параметры запроса:**
- `q` (string, обязательный) - Поисковый запрос
- `limit` (number, необязательный) - Количество результатов (по умолчанию: 10, максимум: 100)
- `page` (number, необязательный) - Номер страницы (по умолчанию: 1)

**Пример запроса:**
```
GET /api/search?q=веб разработка&limit=5&page=1
```

**Структура ответа:**
```json
{
  "results": [
    {
      "id": "page-uuid",
      "title": "Заголовок страницы",
      "url": "https://example.com/page", 
      "content": "Текстовое содержимое страницы...",
      "metaDescription": "Мета-описание страницы",
      "siteId": "site-uuid",
      "lastCrawled": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 25,
  "page": 1,
  "limit": 5,
  "totalPages": 5
}
```

## Особенности Поиска

### Умный Поиск
- **Full-Text Search**: Использует PostgreSQL `tsvector` с весами (заголовки приоритетнее)
- **Similarity Search**: Находит результаты даже при опечатках (similarity > 0.2 для заголовков, > 0.1 для контента)
- **Ранжирование**: Комбинирует FTS rank и similarity score для лучшей сортировки
- **Морфология**: Находит "разработка" по запросу "разработке"

### Поддерживаемые Типы Запросов
```javascript
// Простые слова
"разработка сайтов"

// С опечатками  
"разрабтка" → найдет "разработка"

// Фразы
"веб дизайн услуги"

// Частичные совпадения
"разраб" → найдет "разработка"
```

## Дополнительные API Endpoints

### GET /api/stats
Статистика поискового движка:
```json
{
  "sites": {
    "total": 5,
    "crawling": 0,
    "completed": 3,
    "failed": 1
  },
  "pages": {
    "total": 234
  }
}
```

### GET /api/sites
Список всех индексированных сайтов.

### GET /api/pages
Список всех индексированных страниц.

## Публичный RAG-поиск с LLM

> ⚠️ Все публичные векторные endpoints требуют двух значений из настроек сайта: `publicId` (идентификатор проекта) и `publicApiKey`.
> `publicApiKey` передаётся в заголовке `X-API-Key`, а `publicId` — в пути (`:publicId`) или в параметре `sitePublicId`. Ошибка 401 означает неверный или отсутствующий ключ, 404 — неверный `publicId` либо коллекция не привязана к сайту.

### POST /api/public/collections/:publicId/search/rag

Генеративный RAG-поиск: сервис находит релевантные документы в Qdrant и формирует ответ через выбранную LLM.

**Заголовки:**

- `Content-Type: application/json`
- `X-API-Key: <publicApiKey из настроек сайта>`

**Параметры пути:**

- `:publicId` — публичный идентификатор сайта (тот же, что в админке или в коде виджета).

**Тело запроса:**

```json
{
  "collection": "YOUR_QDRANT_COLLECTION",
  "query": "Как оформить возврат товара?",
  "embeddingProviderId": "EMBEDDING_PROVIDER_ID",
  "llmProviderId": "LLM_PROVIDER_ID",
  "llmModel": "gpt-4o-mini",          // опционально: переопределяет модель по умолчанию
  "limit": 6,                           // опционально: количество документов в ответе
  "contextLimit": 4,                    // опционально: сколько документов попадёт в контекст для LLM (<= limit)
  "responseFormat": "md"               // text (по умолчанию) | md/markdown | html
}
```

**Пример запроса:**

```bash
curl -X POST "https://ваш-домен.replit.dev/api/public/collections/PROJECT_PUBLIC_ID/search/rag" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: PUBLIC_API_KEY" \
  -d '{
    "collection": "support_faq",
    "query": "Как оформить возврат товара?",
    "embeddingProviderId": "gigachat-embeddings",
    "llmProviderId": "gigachat-llm",
    "llmModel": "GigaChat-Pro",
    "limit": 5,
    "contextLimit": 3,
    "responseFormat": "md"
  }'
```

**Пример успешного ответа:**

```json
{
  "answer": "### Возврат товара\n\n1. ...",
  "format": "markdown",
  "usage": {
    "embeddingTokens": 120,
    "llmTokens": 256
  },
  "provider": {
    "id": "gigachat-llm",
    "name": "GigaChat",
    "model": "GigaChat-Pro",
    "modelLabel": "GigaChat-Pro"
  },
  "embeddingProvider": {
    "id": "gigachat-embeddings",
    "name": "GigaChat"
  },
  "collection": "support_faq",
  "context": [
    {
      "id": "point-001",
      "score": 0.81,
      "payload": {
        "title": "Политика возвратов",
        "url": "https://example.com/refund"
      }
    }
  ],
  "queryVector": [0.19, -0.04, 0.52, 0.28],
  "vectorLength": 1536
}
```

**Особенности:**

- Если у провайдера LLM включена поддержка SSE-стриминга (например, GigaChat), можно указать заголовок `Accept: text/event-stream`, тогда ответ придёт постепенно.
- Поле `context` содержит усечённый список документов, который реально попал в контекст LLM (определяется `contextLimit`).
- Значения `limit` и `contextLimit` ограничены сервером: максимум 100 результатов и 50 контекстных записей.
- Для генеративного поиска коллекция Qdrant должна принадлежать тому же workspace, что и сайт, иначе вернётся 404.

## Интеграция с Zero Блоком Тильды

### HTML Структура
```html
<div id="search-widget" class="search-container">
  <div class="search-box">
    <input 
      type="text" 
      id="search-input" 
      placeholder="Поиск по сайту..." 
      class="search-input"
    >
    <button id="search-button" class="search-button">
      <svg class="search-icon" viewBox="0 0 24 24">
        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
      </svg>
    </button>
  </div>
  
  <div id="search-loading" class="search-loading hidden">
    <div class="loading-spinner"></div>
    <span>Поиск...</span>
  </div>
  
  <div id="search-results" class="search-results"></div>
  
  <div id="search-stats" class="search-stats hidden"></div>
  
  <div id="search-error" class="search-error hidden"></div>
</div>
```

### CSS Стили (Современный Дизайн)
```css
.search-container {
  max-width: 600px;
  margin: 0 auto;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  background: #ffffff;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  transition: all 0.2s ease;
  box-shadow: 0 2px 4px rgba(0,0,0,0.04);
}

.search-box:focus-within {
  border-color: #3b82f6;
  box-shadow: 0 4px 12px rgba(59,130,246,0.15);
}

.search-input {
  flex: 1;
  padding: 16px 20px;
  border: none;
  outline: none;
  font-size: 16px;
  background: transparent;
  color: #1f2937;
}

.search-input::placeholder {
  color: #9ca3af;
}

.search-button {
  padding: 12px;
  margin: 4px;
  background: #3b82f6;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.search-button:hover {
  background: #2563eb;
}

.search-icon {
  width: 20px;
  height: 20px;
  stroke: white;
  stroke-width: 2;
  fill: none;
}

.search-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: #6b7280;
}

.loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #e5e7eb;
  border-top: 2px solid #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.search-results {
  margin-top: 24px;
}

.result-item {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
  transition: all 0.2s ease;
  cursor: pointer;
}

.result-item:hover {
  border-color: #3b82f6;
  box-shadow: 0 4px 12px rgba(59,130,246,0.1);
}

.result-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 8px;
  text-decoration: none;
}

.result-title:hover {
  color: #3b82f6;
}

.result-url {
  font-size: 14px;
  color: #059669;
  margin-bottom: 8px;
  word-break: break-all;
}

.result-description {
  color: #4b5563;
  line-height: 1.5;
}

.search-stats {
  text-align: center;
  padding: 16px;
  color: #6b7280;
  font-size: 14px;
  background: #f9fafb;
  border-radius: 8px;
  margin-top: 16px;
}

.search-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  padding: 16px;
  border-radius: 8px;
  margin-top: 16px;
}

.hidden {
  display: none !important;
}

.no-results {
  text-align: center;
  padding: 40px 20px;
  color: #6b7280;
}

/* Адаптивность */
@media (max-width: 768px) {
  .search-container {
    margin: 0 16px;
  }
  
  .search-input {
    font-size: 16px; /* Предотвращает зум на iOS */
  }
  
  .result-item {
    padding: 16px;
  }
}
```

### JavaScript Функциональность
```javascript
class TildaSearchWidget {
  constructor(apiEndpoint) {
    this.apiEndpoint = apiEndpoint;
    this.debounceTimeout = null;
    this.currentQuery = '';
    
    this.init();
  }

  init() {
    this.searchInput = document.getElementById('search-input');
    this.searchButton = document.getElementById('search-button');
    this.loadingEl = document.getElementById('search-loading');
    this.resultsEl = document.getElementById('search-results');
    this.statsEl = document.getElementById('search-stats');
    this.errorEl = document.getElementById('search-error');

    // События
    this.searchInput.addEventListener('input', (e) => this.handleInput(e));
    this.searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.performSearch(e.target.value.trim());
      }
    });
    this.searchButton.addEventListener('click', () => {
      this.performSearch(this.searchInput.value.trim());
    });
  }

  handleInput(e) {
    const query = e.target.value.trim();
    
    // Очистка предыдущего debounce
    clearTimeout(this.debounceTimeout);
    
    if (query.length === 0) {
      this.clearResults();
      return;
    }

    // Живой поиск с задержкой 300ms
    this.debounceTimeout = setTimeout(() => {
      if (query.length >= 2) {
        this.performSearch(query);
      }
    }, 300);
  }

  async performSearch(query) {
    if (!query || query.length < 2) {
      this.showError('Введите минимум 2 символа для поиска');
      return;
    }

    this.currentQuery = query;
    this.showLoading();
    this.hideError();

    try {
      const response = await fetch(
        `${this.apiEndpoint}/search?q=${encodeURIComponent(query)}&limit=10`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      this.displayResults(data, query);
      
    } catch (error) {
      console.error('Search error:', error);
      this.showError('Ошибка поиска. Попробуйте позже.');
    } finally {
      this.hideLoading();
    }
  }

  displayResults(data, query) {
    const { results, total } = data;

    if (!results || results.length === 0) {
      this.resultsEl.innerHTML = `
        <div class="no-results">
          <p>По запросу <strong>"${this.escapeHtml(query)}"</strong> ничего не найдено</p>
          <p>Попробуйте изменить поисковый запрос</p>
        </div>
      `;
      this.hideStats();
      return;
    }

    // Результаты поиска
    this.resultsEl.innerHTML = results.map(result => this.renderResult(result, query)).join('');
    
    // Статистика
    this.showStats(total, query);
  }

  renderResult(result, query) {
    const title = result.title || 'Без названия';
    const description = this.truncateText(
      result.metaDescription || result.content || 'Описание отсутствует', 
      200
    );
    
    return `
      <div class="result-item" onclick="window.open('${result.url}', '_blank')">
        <a href="${result.url}" target="_blank" class="result-title" onclick="event.stopPropagation()">
          ${this.highlightText(this.escapeHtml(title), query)}
        </a>
        <div class="result-url">${this.escapeHtml(result.url)}</div>
        <div class="result-description">
          ${this.highlightText(this.escapeHtml(description), query)}
        </div>
      </div>
    `;
  }

  highlightText(text, query) {
    if (!query) return text;
    
    const words = query.split(/\s+/).filter(word => word.length > 1);
    let highlightedText = text;
    
    words.forEach(word => {
      const regex = new RegExp(`(${this.escapeRegex(word)})`, 'gi');
      highlightedText = highlightedText.replace(regex, '<mark>$1</mark>');
    });
    
    return highlightedText;
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).replace(/\s+\S*$/, '') + '...';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  showLoading() {
    this.loadingEl.classList.remove('hidden');
    this.resultsEl.innerHTML = '';
    this.hideStats();
  }

  hideLoading() {
    this.loadingEl.classList.add('hidden');
  }

  showStats(total, query) {
    this.statsEl.innerHTML = `Найдено <strong>${total}</strong> результатов по запросу <strong>"${this.escapeHtml(query)}"</strong>`;
    this.statsEl.classList.remove('hidden');
  }

  hideStats() {
    this.statsEl.classList.add('hidden');
  }

  showError(message) {
    this.errorEl.innerHTML = message;
    this.errorEl.classList.remove('hidden');
    this.resultsEl.innerHTML = '';
  }

  hideError() {
    this.errorEl.classList.add('hidden');
  }

  clearResults() {
    this.resultsEl.innerHTML = '';
    this.hideStats();
    this.hideError();
  }
}

// Инициализация виджета
document.addEventListener('DOMContentLoaded', function() {
  // ЗАМЕНИТЕ на ваш реальный endpoint
  const searchWidget = new TildaSearchWidget('https://ваш-домен.replit.dev/api');
  
  // Глобальная переменная для доступа из консоли
  window.searchWidget = searchWidget;
});

// CSS для подсветки
const style = document.createElement('style');
style.textContent = `
  mark {
    background: #fef3c7;
    color: #92400e;
    padding: 1px 2px;
    border-radius: 2px;
  }
`;
document.head.appendChild(style);
```

## Готовый Код для Zero Блока Тильды

### Полный HTML + CSS + JS код:
```html
<div id="search-widget" class="search-container">
  <div class="search-box">
    <input type="text" id="search-input" placeholder="Поиск по сайту..." class="search-input">
    <button id="search-button" class="search-button">
      <svg class="search-icon" viewBox="0 0 24 24">
        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
      </svg>
    </button>
  </div>
  <div id="search-loading" class="search-loading hidden">
    <div class="loading-spinner"></div>
    <span>Поиск...</span>
  </div>
  <div id="search-results" class="search-results"></div>
  <div id="search-stats" class="search-stats hidden"></div>
  <div id="search-error" class="search-error hidden"></div>
</div>

<style>
/* Поместите сюда весь CSS код из раздела выше */
</style>

<script>
/* Поместите сюда весь JavaScript код из раздела выше */
</script>
```

## Конфигурация для ChatGPT

Используйте эту инструкцию для создания поиска в Тильде:

```
Создай современный поисковый виджет для Zero блока Тильды со следующими характеристиками:

API: https://ваш-домен.replit.dev/api/search?q=ЗАПРОС&limit=10
Ответ API: {results: [{title, url, content, metaDescription}], total, page, limit}

Требования:
1. Современный дизайн в стиле Google/Algolia
2. Живой поиск с debounce 300ms
3. Индикатор загрузки и обработка ошибок  
4. Подсветка найденных слов в результатах
5. Адаптивность для мобильных устройств
6. Анимации и плавные переходы
7. Открытие ссылок в новой вкладке

Особенности поиска:
- Работает с опечатками
- Поддерживает морфологию (склонения)
- Умное ранжирование результатов
- Поиск по заголовкам и содержимому

Создай единый HTML блок с inline CSS и JavaScript.
```

## Дополнительные Возможности

### Webhook для Автоматического Переиндексирования
```javascript
// POST /api/webhook/crawl
// Для автоматического обновления индекса после публикации в Тильде
fetch('https://ваш-домен.replit.dev/api/webhook/crawl', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://ваш-сайт.com' })
});
```

### Аналитика Поисковых Запросов
```javascript
// Отправка данных о поисках в Google Analytics
searchWidget.onSearch = function(query, resultsCount) {
  gtag('event', 'search', {
    'search_term': query,
    'search_results': resultsCount
  });
};
```

## Поддержка и Оптимизация

### Рекомендации по Производительности:
1. **Кеширование**: Результаты кешируются в localStorage на 5 минут
2. **Debounce**: 300ms задержка для живого поиска
3. **Минимальная длина запроса**: 2 символа
4. **Лимит результатов**: Максимум 50 на страницу

### Мониторинг:
- Статистика доступна через `/api/stats`
- Логи ошибок в консоли браузера
- Время ответа API отслеживается

### Техническая Поддержка:
Поисковый движок развернут на Replit с автоматическим масштабированием и резервным копированием данных.

---

**Готово к использованию!** Скопируйте код, замените `https://ваш-домен.replit.dev/api` на ваш реальный endpoint и интегрируйте в Тильду.
