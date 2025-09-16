# Design Guidelines for Lightweight Search Engine

## Design Approach
**System-Based Approach**: Using a clean, utility-focused design system similar to Linear/Notion for the admin interface, with a minimalist search experience inspired by modern search engines.

## Core Design Elements

### Color Palette
**Light Mode:**
- Primary: 216 100% 50% (Blue)
- Background: 0 0% 98% (Light gray)
- Surface: 0 0% 100% (White)
- Text: 220 9% 12% (Dark gray)
- Border: 220 13% 91% (Light border)

**Dark Mode:**
- Primary: 216 100% 60% (Lighter blue)
- Background: 220 13% 7% (Dark background)
- Surface: 220 13% 10% (Dark surface)
- Text: 210 40% 98% (Light text)
- Border: 220 13% 20% (Dark border)

### Typography
- **Primary Font**: Inter (via Google Fonts CDN)
- **Headings**: Font weight 600-700, sizes from text-lg to text-3xl
- **Body**: Font weight 400, text-sm to text-base
- **Code/URLs**: Mono font family for technical displays

### Layout System
**Spacing**: Use Tailwind units of 2, 4, 6, and 8 (p-4, m-6, gap-8, etc.)
- Consistent padding/margins across components
- Generous whitespace for readability
- Grid-based layouts with proper alignment

### Component Library

**Admin Interface:**
- Clean sidebar navigation with icon + text
- Card-based content areas with subtle shadows
- Form inputs with proper focus states
- Status indicators (crawling, indexed, error states)
- Data tables with sorting and filtering
- Modal dialogs for configuration

**Search Interface:**
- Minimal header with logo/branding
- Centered search bar with prominent styling
- Clean results list with title, snippet, and URL
- Pagination controls
- Search filters/facets if needed

**Core Components:**
- Buttons: Primary (filled), secondary (outline), ghost variants
- Input fields: Clean borders, focus rings, validation states
- Cards: Subtle shadows, rounded corners
- Navigation: Breadcrumbs, tabs, sidebar menu
- Feedback: Toast notifications, loading states, empty states

### Key Design Principles
1. **Clarity over Decoration**: Function-first approach with minimal visual flourishes
2. **Consistent Spacing**: Systematic use of spacing scale
3. **Accessible Contrast**: Proper color contrast in both light/dark modes
4. **Responsive Design**: Mobile-first approach with breakpoint considerations
5. **Performance-Oriented**: Lightweight components, minimal animations

### Search Experience
- Google-inspired clean search interface
- Results presented with clear hierarchy
- Snippet previews with search term highlighting
- Fast, responsive interactions
- Clear "no results" and loading states

### Admin Dashboard
- Data-dense tables for crawl status and indexed pages
- Simple forms for adding URLs and configuring crawlers
- Real-time status updates during crawling
- Clear error reporting and resolution guidance
- Webhook configuration interface

This design approach prioritizes usability and performance while maintaining a professional, trustworthy appearance suitable for enterprise deployment.