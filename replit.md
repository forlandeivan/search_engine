# Lightweight Search Engine

## Overview

This is a lightweight search engine application designed for crawling and indexing websites to provide fast, localized search functionality. The system consists of a React-based admin interface for managing crawl configurations and a public search interface for end users. Built with TypeScript, Express.js backend, and PostgreSQL database, it provides comprehensive web crawling capabilities with real-time status monitoring and search result delivery.

## Recent Changes

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