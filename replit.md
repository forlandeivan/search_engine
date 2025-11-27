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
- Required secrets: `apiKey` (Yandex Cloud API key), `folderId` (Yandex Cloud folder ID), `serviceAccountKey` (Yandex Cloud Service Account Key for IAM token generation)
- Configurable options: `languageCode`, `model`, `enablePunctuation`

**Supported Audio Formats:** OGG (preferred), WebM (auto-converted to OGG via ffmpeg), WAV, MP3
**Max File Size (Sync API):** 1 MB (for instant transcription)
**Max File Size (Async API):** 500 MB (requires Object Storage for files > 1 MB)
**System Dependency:** ffmpeg (for WebM to OGG conversion)

### Object Storage Integration (Large Files)

For transcribing audio files larger than 1 MB, the system uses Yandex Object Storage (S3-compatible):

**Backend Services:**
- `server/yandex-object-storage-service.ts`: Handles S3-compatible uploads to Yandex Object Storage
- Uses `@aws-sdk/client-s3` for S3 API compatibility

**Pipeline for Large Files (> 1 MB):**
1. User uploads audio file via chat
2. File is uploaded to Yandex Object Storage bucket
3. Object Storage URI is sent to SpeechKit async API
4. System polls for transcription completion
5. Result is returned as chat message
6. Temporary file is deleted from Object Storage

**Configuration (Admin Panel → Speech Providers):**
- `s3AccessKeyId`: Static access key ID for Object Storage
- `s3SecretAccessKey`: Static secret access key for Object Storage
- `s3BucketName`: Bucket name for storing audio files

**Creating Object Storage Credentials:**
1. Create Service Account in Yandex Cloud Console
2. Assign `storage.editor` role to the service account
3. Create static access key for the service account
4. Create bucket in Object Storage
5. Enter credentials in admin panel

### IAM Token Management (Async STT)

**Async Audio Transcription** is implemented via Yandex SpeechKit long operations API:

**Backend Services:**
- `server/yandex-iam-token-service.ts`: Handles IAM token generation using PS256 JWT signing and Yandex Cloud IAM API
- `server/yandex-stt-async-service.ts`: Submits audio files for async transcription and retrieves operation status
- API endpoint `POST /api/chat/transcribe` (with async mode): Initiates async transcription and returns `operationId`
- API endpoint `GET /api/chat/transcribe/operations/:operationId`: Polls for transcription completion status
- Admin endpoint `POST /api/admin/tts-stt/providers/:id/test-iam-token`: Tests IAM token generation

**Frontend:**
- Polling mechanism in ChatPage to check transcription completion
- Auto-polling every 2 seconds until completion or timeout

**Authentication:**
- Service Account Key (JSON) stored in provider secrets - must include `id` (key_id), `service_account_id`, and `private_key`
- IAM token automatically generated using PS256 (RSA-PSS) algorithm and cached (11-hour lifetime)
- Token expiration handled with 5-minute safety buffer

**Technical Details (Yandex Cloud IAM API):**
- Endpoint: `https://iam.api.cloud.yandex.net/iam/v1/tokens`
- JWT Algorithm: PS256 (RSA-PSS with SHA-256)
- JWT Header must include `kid` (key_id from Service Account Key)
- Request format: JSON body `{"jwt": "<signed_jwt>"}`
- Response format: `{"iamToken": "t1.xxx...", "expiresAt": "..."}`

**Two Modes of Operation:**

**MODE 1: Pre-generated Token**
- Set in admin panel "IAM Mode: Manual" and paste token
- Or set env var `YANDEX_IAM_TOKEN` with a pre-generated token
- Generate token via Yandex Cloud CLI: `yc iam create-token`
- Valid for 12 hours, update when expired

**MODE 2: Auto-generated Token (Default)**
- System automatically generates JWT from Service Account Key
- Requests token from `iam.api.cloud.yandex.net` (correct endpoint)
- Token is cached and reused for 11 hours
- Requires valid Service Account Key with all three fields: `id`, `service_account_id`, `private_key`

**Priority:**
1. If admin panel has "Manual" mode with token → Use MODE 1
2. If `YANDEX_IAM_TOKEN` env var is set → Use MODE 1
3. Otherwise → Use MODE 2 (auto-generate)

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
