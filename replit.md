# Lightweight Search Engine

## Overview

This is a lightweight search engine application designed for crawling and indexing websites to provide fast, localized search functionality. The system consists of a React-based admin interface for managing crawl configurations and a public search interface for end users. Built with TypeScript, Express.js backend, and PostgreSQL database, it provides comprehensive web crawling capabilities with real-time status monitoring and search result delivery.

## Recent Changes

### October 30, 2025
- **Database schema synchronized**: Full schema migration with ltree extension enabled for hierarchical structures
- **RAG API infrastructure created**: Public RAG search endpoint configured and ready for deployment
- **Production deployment prepared**: Chromium system dependency installed for Puppeteer support
- **Demo workspace initialized**: Created test workspace with embedding and LLM providers

### October 2025
- **Hierarchical document structure**: Full support for nesting documents within other documents (like Confluence)
- **Document parents**: Documents can now be parents for other documents (folders can only be parented by folders)
- **Nested children management**: UI shows list of nested documents with ability to create new nested documents
- **Tree recursion**: TreeMenu component properly displays nested documents at any depth
- **Backend validation**: Prevents circular dependencies and self-parenting with proper ltree path management

### September 2025
- **Re-crawl functionality implemented**: Complete system for re-crawling existing sites without creating duplicates
- **Database flexibility**: Configurable PostgreSQL connection with automatic fallback to Neon
- **Упрощённая админ-панель**: основной AdminPage с управлением краулингом и повторными обходами
- **Duplicate prevention**: Crawler now checks existing pages before adding new ones
- **Real-time status updates**: Live progress tracking during crawling operations

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript using Vite as the build tool
- **UI Library**: Shadcn/ui components built on Radix UI primitives with Tailwind CSS
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack Query for server state management and caching
- **Design System**: Custom design system with Inter font, CSS variables for theming, and consistent spacing/color schemes

### Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **API Design**: RESTful API endpoints for sites, pages, crawling, search operations, and re-crawling functionality
- **Web Crawler**: Custom crawler using Cheerio for HTML parsing and node-fetch for HTTP requests with duplicate detection
- **Re-crawl System**: Comprehensive re-crawling capability that resets site status and adds only new pages
- **Build System**: ESBuild for production bundling

### Data Storage Solutions
- **Database**: Flexible PostgreSQL connection with automatic fallback (External → Neon)
- **Connection Logic**: Configurable external PostgreSQL server with Neon serverless as backup
- **ORM**: Drizzle ORM for type-safe database operations
- **Schema Design**: 
  - Sites table for crawl configurations, status tracking, and re-crawl capabilities
  - Pages table for crawled content with full-text indexing and duplicate prevention
  - Search index table for optimized text search performance
  - Relational design with foreign key constraints and cascading deletes

### Authentication and Authorization
- **Current State**: No authentication system implemented
- **Session Management**: Express session infrastructure prepared with connect-pg-simple
- **Future Ready**: User schema defined for potential admin authentication features

### External Dependencies
- **Database Hosting**: Neon serverless PostgreSQL
- **Font Loading**: Google Fonts CDN for Inter font family
- **Development Tools**: Replit integration with cartographer and runtime error overlay
- **UI Components**: Radix UI primitives for accessible component foundation
- **Styling**: Tailwind CSS with PostCSS processing

## Настройка CORS для кастомных доменов

При подключении своего домена убедитесь, что Express-сервер разрешает запросы с этого хоста. Для этого есть два варианта:

1. Добавьте домен в список сайтов в админ-панели (таблица `sites`). Тогда домен автоматически попадёт в CORS-кэш.
2. Если база данных временно недоступна (например, на холодном старте), задайте переменную окружения `STATIC_ALLOWED_HOSTNAMES` (или `STATIC_ALLOWED_ORIGINS`) со списком доменов через запятую. Пример значения:
   ```env
   STATIC_ALLOWED_HOSTNAMES=aiknowledge.ru,www.aiknowledge.ru
   ```

Статический список учитывается при каждом обновлении CORS-кэша, поэтому домен будет доступен даже если база данных не успела ответить. В логах сервера появится сообщение с перечнем статически разрешённых доменов.

## External Dependencies

### Core Dependencies
- **@neondatabase/serverless**: Serverless PostgreSQL client for Neon database connectivity
- **pg**: Standard PostgreSQL client for external database connections
- **drizzle-orm**: Type-safe ORM for database operations and migrations (supports both Neon and standard PostgreSQL)
- **@tanstack/react-query**: Server state management and caching with real-time updates
- **cheerio**: Server-side HTML parsing for web crawling
- **node-fetch**: HTTP client for web crawling requests

### UI and Styling
- **@radix-ui/***: Accessible UI component primitives (dialog, dropdown, sidebar, etc.)
- **tailwindcss**: Utility-first CSS framework
- **class-variance-authority**: Type-safe variant management for components
- **clsx**: Utility for conditional className joining

### Development and Build Tools
- **vite**: Frontend build tool and development server
- **tsx**: TypeScript execution for Node.js development
- **esbuild**: Fast JavaScript bundler for production builds
- **@replit/vite-plugin-***: Replit-specific development enhancements

### Runtime Dependencies
- **express**: Web application framework
- **wouter**: Lightweight React router
- **date-fns**: Date manipulation and formatting utilities
- **cmdk**: Command palette component for enhanced UX

## RAG API Configuration

### Public RAG Search Endpoint

API endpoint for Retrieval-Augmented Generation (RAG) search is available at:
```
POST https://aiknowledge.ru/api/public/collections/search/rag
```

### Current Infrastructure

**Workspace:**
- ID: `eb3ecef0-2e4a-464c-843a-9ce5d24d8051`
- Name: AI Knowledge Workspace

**API Key:**
- `1a76fe18f9ee4ba571e2310ea973489aaa7d5b357463eca297269cf0facd05a3`

**Registered Collections:**
- `new2222222222222222222` (registered in workspace)

**Embedding Provider:**
- ID: `269022b8-4980-4f6c-8583-a70f73b3e98b`
- Type: GigaChat
- Vector Size: 1024

**LLM Provider:**
- ID: `59f44b6d-0fef-4082-9d76-ffb922c41825`
- Type: GigaChat
- Default Model: GigaChat-Max
- Available Models: GigaChat, GigaChat-Plus, GigaChat-Pro, GigaChat-Max

### ⚠️ Important: API Keys Configuration

The embedding and LLM providers were created with placeholder authorization keys (`'your-authorization-key-here'`). Before using the RAG API in production, you **must** update these providers with real GigaChat API credentials:

**Option 1: Update via SQL**
```sql
-- Update Embedding Provider
UPDATE embedding_providers 
SET authorization_key = 'YOUR_REAL_GIGACHAT_KEY'
WHERE id = '269022b8-4980-4f6c-8583-a70f73b3e98b';

-- Update LLM Provider
UPDATE llm_providers 
SET authorization_key = 'YOUR_REAL_GIGACHAT_KEY'
WHERE id = '59f44b6d-0fef-4082-9d76-ffb922c41825';
```

**Option 2: Update via Admin Interface**
Navigate to the providers management page in the admin interface and update the authorization keys there.

### Example Request

```bash
curl -X POST 'https://aiknowledge.ru/api/public/collections/search/rag' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: 1a76fe18f9ee4ba571e2310ea973489aaa7d5b357463eca297269cf0facd05a3' \
  -d '{
    "collection": "new2222222222222222222",
    "workspaceId": "eb3ecef0-2e4a-464c-843a-9ce5d24d8051",
    "embeddingProviderId": "269022b8-4980-4f6c-8583-a70f73b3e98b",
    "llmProviderId": "59f44b6d-0fef-4082-9d76-ffb922c41825",
    "llmModel": "GigaChat-Max",
    "query": "чем полезен сервис?",
    "responseFormat": "md",
    "limit": 5,
    "contextLimit": 4
  }'
```

## Production Deployment Notes

### Chromium for Puppeteer

Chromium is installed as a system dependency for web crawling functionality:
- Path: `/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium`
- Environment variable: Set `PUPPETEER_EXECUTABLE_PATH` in Replit Secrets for production deployment
- Fallback: Application will use node-fetch if Chromium is unavailable