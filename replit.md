# Citation Converter Web Application

## Overview

This is a full-stack web application that allows users to convert academic references between different citation styles (APA, MLA, Harvard, Chicago, IEEE, Vancouver). The application features a modern React frontend with a Node.js/Express backend, designed to parse citations in various formats and convert them to target styles.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Styling**: Tailwind CSS with Shadcn/UI component library
- **State Management**: React Query (@tanstack/react-query) for server state
- **Routing**: Wouter for client-side routing
- **Build Tool**: Vite for development and bundling

### Backend Architecture
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Architecture Pattern**: Service-oriented with clear separation of concerns
- **API Style**: RESTful API endpoints

### Data Storage
- **Database**: PostgreSQL (configured via Drizzle ORM)
- **ORM**: Drizzle ORM with Zod schema validation
- **Fallback Storage**: In-memory storage for development/testing
- **Database Provider**: Neon Database (@neondatabase/serverless)

## Key Components

### Core Services
1. **CitationParser**: Detects citation styles and parses reference text into structured data
2. **CitationConverter**: Converts parsed references between different citation styles
3. **Storage Service**: Handles database operations for reference storage and retrieval

### Frontend Components
1. **CitationConverter**: Main application component orchestrating the conversion flow
2. **ReferenceInput**: Input interface with style detection and validation
3. **ReferenceOutput**: Results display with export and copy functionality
4. **Processing/Error UI**: User feedback components for operation status

### API Endpoints
- `POST /api/convert`: Main conversion endpoint accepting references array and style parameters

## Data Flow

1. **Input Processing**: User inputs references and selects input/output citation styles
2. **Style Detection**: System auto-detects citation style if "auto" is selected
3. **Parsing**: References are parsed into structured data objects
4. **Conversion**: Structured data is converted to target citation style
5. **Storage**: Successful conversions are stored in the database
6. **Response**: Converted references are returned to the frontend with error handling

## External Dependencies

### Frontend Dependencies
- **UI Components**: Radix UI primitives via Shadcn/UI
- **Styling**: Tailwind CSS with custom theming
- **Forms**: React Hook Form with Hookform resolvers
- **Icons**: Lucide React icons
- **Utilities**: Class Variance Authority, clsx, date-fns

### Backend Dependencies
- **Database**: Drizzle ORM, Neon Database serverless driver
- **Validation**: Zod for schema validation
- **Session Management**: Connect-pg-simple for PostgreSQL sessions
- **Development**: TSX for TypeScript execution, ESBuild for production builds

## Deployment Strategy

### Development
- **Frontend**: Vite dev server with HMR
- **Backend**: TSX for direct TypeScript execution
- **Database**: Drizzle migrations via `drizzle-kit push`

### Production
- **Frontend**: Vite build to static assets in `dist/public`
- **Backend**: ESBuild compilation to `dist/index.js`
- **Database**: PostgreSQL with connection via DATABASE_URL environment variable
- **Runtime**: Node.js production server

### Environment Configuration
- Database connection via `DATABASE_URL` environment variable
- Separate development and production build processes
- Static asset serving integrated with Express in production

## Changelog
- July 07, 2025. Initial setup

## User Preferences

Preferred communication style: Simple, everyday language.