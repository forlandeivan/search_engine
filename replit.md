# Lightweight Search Engine

## Overview

This project is a lightweight search engine application designed for crawling and indexing websites to provide fast, localized search functionality. It features a React-based admin interface for managing crawl configurations and a public search interface for end users. The system is built with TypeScript, an Express.js backend, and a PostgreSQL database. It offers comprehensive web crawling capabilities with real-time status monitoring and efficient search result delivery, including Retrieval-Augmented Generation (RAG) functionality. The vision is to enable users to quickly set up and manage specialized search engines for their content, enhancing information retrieval and user experience.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The frontend is built using React 18 with TypeScript and Vite. It leverages Shadcn/ui components, based on Radix UI primitives, styled with Tailwind CSS. Wouter is used for client-side routing, and TanStack Query manages server state and caching. The design system incorporates the Inter font, CSS variables for theming, and consistent spacing and color schemes.

### Backend Architecture

The backend utilizes Node.js with the Express.js framework, written in TypeScript with ES modules. It provides RESTful API endpoints for managing sites, pages, crawling operations, search queries, and re-crawling functionality. A custom web crawler uses Cheerio for HTML parsing and node-fetch for HTTP requests, incorporating duplicate detection. A robust re-crawl system is in place to reset site status and add only new pages efficiently. ESBuild is used for production bundling.

### Data Storage Solutions

The application uses a flexible PostgreSQL connection with automatic fallback. It supports both an external PostgreSQL server (for production) and Neon serverless PostgreSQL (for development/backup). Drizzle ORM ensures type-safe database operations. The schema includes tables for `sites` (crawl configurations, status, re-crawl), `pages` (crawled content, full-text indexing, duplicate prevention), and a `search_index` table for optimized text search performance. The design includes relational foreign key constraints and cascading deletes. Separate Drizzle configurations are maintained for development and production databases.

### Database Management

Two distinct PostgreSQL databases are used: a development database (Neon) for local testing and a production database (External PostgreSQL) for live application data. Schema migrations are managed via `drizzle-kit`, with shell scripts (`db-push-dev.sh`, `db-push-prod.sh`) to simplify execution. The production migration script includes safety mechanisms like confirmation prompts.

### Authentication and Authorization

Currently, no authentication system is implemented, but Express session infrastructure with `connect-pg-simple` is prepared. A user schema is defined, anticipating future admin authentication features.

### RAG API Configuration

A public RAG search endpoint is available, configured with specific workspaces, API keys, embedding providers (GigaChat), and LLM providers (GigaChat-Max). This infrastructure enables advanced natural language querying against indexed content.

### TTS/STT Integration (Audio Transcription)

The application supports audio file transcription in chat via Yandex SpeechKit integration:

**Backend Components:**
- `server/yandex-stt-service.ts`: Service for transcribing audio to text using Yandex SpeechKit REST API v1
- `server/speech-provider-service.ts`: Manages speech provider configuration (API keys, folder IDs, settings)
- API endpoint `POST /api/chat/transcribe`: Accepts audio via multipart/form-data and returns transcribed text
- API endpoint `GET /api/chat/transcribe/status`: Checks if STT provider is available and configured

**Frontend Components:**
- `client/src/components/chat/ChatInput.tsx`: Chat input with paperclip button for attaching audio files
- Audio file upload integrated into ChatPage with transcription displayed as AI response

**User Flow:**
1. User clicks paperclip icon in chat input
2. User selects an audio file (OGG, WebM, WAV, MP3, etc.)
3. File is uploaded and transcribed via Yandex SpeechKit
4. Transcription result is displayed as an AI assistant message

**Configuration:**
- Admin panel at `/admin/speech-providers` for configuring Yandex SpeechKit credentials
- Required secrets: `apiKey` (Yandex Cloud API key), `folderId` (Yandex Cloud folder ID)
- Configurable options: `languageCode`, `model`, `enablePunctuation`

**Supported Audio Formats:** OGG (preferred), WebM (auto-converted to OGG via ffmpeg), WAV, MP3
**Max File Size:** 10 MB (Yandex SpeechKit sync API limit: 1 MB after conversion)
**System Dependency:** ffmpeg (for WebM to OGG conversion)

### Production Deployment Notes

For Replit Autoscale deployment, the server binds to `0.0.0.0:5000`. A fast health check endpoint (`/health`) is provided. The server employs a non-blocking startup, allowing asynchronous database initialization. Critical production secrets are validated on startup. Graceful shutdown handlers are implemented to ensure proper resource cleanup upon termination. Chromium is installed as a system dependency for Puppeteer-based crawling, with `PUPPETEER_EXECUTABLE_PATH` configurable via environment variables.

### CORS Configuration

CORS is managed by allowing domains listed in the `sites` table in the admin panel. Additionally, `STATIC_ALLOWED_HOSTNAMES` or `STATIC_ALLOWED_ORIGINS` environment variables can be set for static domain whitelisting, especially during cold starts or database unavailability.

## External Dependencies

### Core Dependencies

-   `@neondatabase/serverless`: Serverless PostgreSQL client.
-   `pg`: Standard PostgreSQL client.
-   `drizzle-orm`: Type-safe ORM for database operations.
-   `@tanstack/react-query`: Server state management and caching.
-   `cheerio`: Server-side HTML parsing.
-   `node-fetch`: HTTP client for web crawling.

### UI and Styling

-   `@radix-ui/*`: Accessible UI component primitives.
-   `tailwindcss`: Utility-first CSS framework.
-   `class-variance-authority`: Type-safe variant management.
-   `clsx`: Utility for conditional className joining.

### Development and Build Tools

-   `vite`: Frontend build tool and development server.
-   `tsx`: TypeScript execution for Node.js development.
-   `esbuild`: Fast JavaScript bundler.
-   `@replit/vite-plugin-*`: Replit-specific development enhancements.

### Runtime Dependencies

-   `express`: Web application framework.
-   `wouter`: Lightweight React router.
-   `date-fns`: Date manipulation utilities.
-   `cmdk`: Command palette component.

### Database Hosting

-   **Neon serverless PostgreSQL**: For development and backup.

### Font Loading

-   **Google Fonts CDN**: For the Inter font family.