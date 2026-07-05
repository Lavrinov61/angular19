# Testimonials Component for МагнусФото

This document outlines the different design variants available for the testimonials/reviews component created for the МагнусФото website.

## Overview

The testimonials component is designed to showcase customer reviews and ratings from various platforms. It follows the Angular Material design system with proper use of tokens and is compatible with Server-Side Rendering (SSR).

## Available Variants

There are three design variants available:

1. **Card Layout (Default)** - `variant="card"`
   - Clean, card-based design with responsive grid layout
   - Each testimonial displayed in its own Material card
   - Rating stars and source links for each testimonial
   - Good for displaying multiple testimonials at once

2. **Slider Layout** - `variant="slider"`
   - Modern, interactive slider that cycles through testimonials
   - Animated transitions between testimonials
   - Navigation buttons and indicator dots
   - Auto-sliding with 5-second interval
   - Best for highlighting individual testimonials in a compact space

3. **Minimal Layout** - `variant="minimal"`
   - Elegant, typography-focused design
   - Vertical layout with clean separators
   - Quote icons and subtle styling
   - Best for text-heavy testimonials and formal presentations

## Schema.org Integration

All variants include proper schema.org markup for reviews using the JSON-LD format, which improves SEO and enables rich snippets in search results.

## Usage

The component can be used in any Angular component template:

```typescript
// In your component
import { TestimonialsComponent } from '@app/shared/components/testimonials/testimonials.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [TestimonialsComponent],
  template: `
    <!-- Default card variant -->
    <app-testimonials></app-testimonials>
    
    <!-- OR specify a variant -->
    <app-testimonials variant="slider"></app-testimonials>
  `
})
export class HomeComponent {}
```

## Firebase Integration

The testimonials component fetches data from Firebase using the TestimonialService. The service is designed to be SSR-compatible and uses the proper Angular pattern for platform detection.

## Customization

The components use Angular Material's token system for theming with the `--mat-sys-` prefix as required. This ensures the testimonials will automatically adapt to any theme changes.

Key tokens used:

- `--mat-sys-color-primary`
- `--mat-sys-color-on-primary`
- `--mat-sys-color-surface`
- `--mat-sys-color-on-surface`
- `--mat-sys-color-surface-container-low`
- `--mat-sys-color-surface-container-high`
- `--mat-sys-color-warning` (for stars)

## Accessibility

All variants are built with accessibility in mind:

- Proper semantic HTML structure
- ARIA labels for interactive elements
- Keyboard navigation support
- Sufficient color contrast
- Screen reader friendly

## SSR Compatibility

The component is designed to work with Angular SSR using the modern `@angular/ssr` approach as specified in the project requirements. It properly handles platform detection and ensures a smooth hydration process.
