import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TestimonialSection } from './testimonial.model';

@Injectable({
  providedIn: 'root'
})
export class TestimonialSchemaService {
  private platformId = inject(PLATFORM_ID);
  /**
   * Generate JSON-LD schema for testimonials
   * 
   * @param data The testimonial data
   * @returns A properly formatted JSON-LD script element string
   */
  generateJsonLd(data: TestimonialSection): string {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      'name': 'Своё Фото',
      'aggregateRating': {
        '@type': 'AggregateRating',
        'ratingValue': data.overallRating.toString(),
        'reviewCount': data.reviewCount.toString(),
        'bestRating': '5',
        'worstRating': '1'
      },
      'review': data.testimonials.map(testimonial => ({
        '@type': 'Review',
        'author': {
          '@type': 'Person',
          'name': testimonial.author
        },
        'reviewRating': {
          '@type': 'Rating',
          'ratingValue': testimonial.rating.toString(),
          'bestRating': '5',
          'worstRating': '1'
        },
        'reviewBody': testimonial.content
      }))
    };

    return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
  }

  /**
   * Insert the JSON-LD schema into the document head
   * 
   * @param data The testimonial data
   */  insertSchema(data: TestimonialSection): void {
    // Проверка платформы - только в браузере можем работать с DOM
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    
    // This would be used in a browser-only context, not during SSR
    this.generateJsonLd(data);

    // Create a script element
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.text = JSON.stringify(data);
    
    // Add to document head
    document.head.appendChild(script);
  }
}
