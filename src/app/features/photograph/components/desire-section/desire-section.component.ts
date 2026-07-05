import { Component, ChangeDetectionStrategy, input, inject, ElementRef, ChangeDetectorRef, viewChild, afterNextRender, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { Photographer, PhotographerService } from '../../models/photographer.model';
import { LoggerService } from '../../../../core/services/logger.service';

interface TestimonialReaction {
  id: string;
  authorName?: string;
  rating: number;
  text: string;
  date: Date;
  avatar?: string;
  verified?: boolean;
  serviceType?: string;
  photos?: {
    url: string;
    thumbnail?: string;
    description?: string;
  }[];
  likes?: number;
  liked?: boolean;
}

interface ValueProposition {
  icon: string;
  text: string;
}

interface PaymentMethod {
  icon: string;
  name: string;
}

@Component({
  selector: 'app-desire-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatChipsModule,
  ],
  templateUrl: './desire-section.component.html',
  styleUrl: './desire-section.component.scss'
})
export class DesireSectionComponent {
  photographer = input.required<Photographer>();
  readonly isMobile = input(false);
  readonly isTablet = input(false);
  readonly isDesktop = input(false);

  readonly testimonialsElement = viewChild('testimonialsElement', { read: ElementRef });
  readonly servicesElement = viewChild('servicesElement', { read: ElementRef });
  readonly testimonialsTrack = viewChild('testimonialsTrack', { read: ElementRef });

  // Testimonials carousel
  activeTestimonialIndex = 0;
  testimonialOffset = 0;
  autoPlayInterval?: number;
  
  // Floating reviews system
  showFloatingReviews = false;
  randomReviews: TestimonialReaction[] = [];
  floatingReviewsInterval?: number;
  
  // Title animation
  titleParts = ['Что', 'говорят', 'о', 'моей', 'работе'];
  
  // Value propositions
  valuePropositions: ValueProposition[] = [
    { icon: 'photo_camera', text: 'Профессиональная техника' },
    { icon: 'edit', text: 'Авторская обработка' },
    { icon: 'cloud_download', text: 'Онлайн галерея' },
    { icon: 'support_agent', text: 'Ежедневная поддержка' }
  ];
  
  // Payment methods
  paymentMethods: PaymentMethod[] = [
    { icon: 'credit_card', name: 'Банковские карты' },
    { icon: 'phone_android', name: 'СБП' },
    { icon: 'account_balance', name: 'Наличными' },
    { icon: 'payment', name: 'Рассрочка' }
  ];
  
  private intersectionObserver?: IntersectionObserver;
  private resizeObserver?: ResizeObserver;
  
  private cdr = inject(ChangeDetectorRef);
  private log = inject(LoggerService);
  private destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      this.initializeFloatingReviews();
      this.startAutoPlayCarousel();
      this.setupIntersectionObserver();
      this.setupResizeObserver();
    });

    this.destroyRef.onDestroy(() => this.cleanup());
  }
  
  private cleanup(): void {
    if (this.autoPlayInterval) {
      clearInterval(this.autoPlayInterval);
    }
    if (this.floatingReviewsInterval) {
      clearInterval(this.floatingReviewsInterval);
    }
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }
    private initializeFloatingReviews(): void {
    // Create floating reviews from testimonials
    if (this.photographer().clientTestimonials && this.photographer().clientTestimonials.length > 0) {
      this.randomReviews = this.photographer().clientTestimonials
        .sort(() => Math.random() - 0.5)
        .slice(0, 3)
        .map(testimonial => ({
          ...testimonial,
          id: testimonial.id,
          authorName: testimonial.authorName || testimonial.clientName,
          rating: testimonial.rating,
          text: testimonial.text.substring(0, 60) + '...',
          date: new Date(testimonial.date),
          avatar: testimonial.avatar || testimonial.clientImage || '/assets/images/default-avatar.png'
        }));
      
      // Show floating reviews periodically
      setTimeout(() => {
        this.showFloatingReviews = true;
        this.cdr.detectChanges();
        
        this.floatingReviewsInterval = window.setInterval(() => {
          this.showFloatingReviews = false;
          setTimeout(() => {
            this.randomizeFloatingReviews();
            this.showFloatingReviews = true;
            this.cdr.detectChanges();
          }, 1000);
        }, 10000);
      }, 3000);
    }
  }
    private randomizeFloatingReviews(): void {
    this.randomReviews = this.photographer().clientTestimonials
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map(testimonial => ({
        ...testimonial,
        id: testimonial.id,
        authorName: testimonial.authorName || testimonial.clientName,
        rating: testimonial.rating,
        text: testimonial.text.substring(0, 60) + '...',
        date: new Date(testimonial.date),
        avatar: testimonial.avatar || testimonial.clientImage || '/assets/images/default-avatar.png'
      }));
  }
  
  private enhanceTestimonials(): void {
    // Note: We can't mutate the input signal, so this method is now a no-op
    // Enhanced properties should be added at the data source level
  }
  
  private getRandomServiceType(): string {
    const services = ['Портретная съемка', 'Семейная фотосессия', 'Свадебная съемка', 'Студийная съемка'];
    return services[Math.floor(Math.random() * services.length)];
  }
  
  private startAutoPlayCarousel(): void {
    this.autoPlayInterval = window.setInterval(() => {
      if (this.photographer().clientTestimonials && this.photographer().clientTestimonials.length > 1) {
        this.nextTestimonial();
      }
    }, 5000);
  }
  
  private setupIntersectionObserver(): void {
    const options = {
      threshold: 0.2,
      rootMargin: '0px 0px -100px 0px'
    };
    
    this.intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const element = entry.target as HTMLElement;
          element.classList.add('animate-in');
          
          // Trigger specific animations based on element
          if (element === this.testimonialsElement()?.nativeElement) {
            this.animateTestimonials();
          } else if (element === this.servicesElement()?.nativeElement) {
            this.animateServices();
          }
        }
      });
    }, options);
    
    // Observe elements
    const testimonialsElement = this.testimonialsElement();
    if (testimonialsElement) {
      this.intersectionObserver.observe(testimonialsElement.nativeElement);
    }
    const servicesElement = this.servicesElement();
    if (servicesElement) {
      this.intersectionObserver.observe(servicesElement.nativeElement);
    }
  }
  
  private setupResizeObserver(): void {
    const testimonialsTrack = this.testimonialsTrack();
    if (testimonialsTrack) {
      this.resizeObserver = new ResizeObserver(() => {
        this.updateCarouselPosition();
      });
      this.resizeObserver.observe(testimonialsTrack.nativeElement);
    }
  }
  
  private animateTestimonials(): void {
    // Add staggered animation to testimonial cards
    const cards = document.querySelectorAll('.testimonial-card');
    cards.forEach((card, index) => {
      setTimeout(() => {
        card.classList.add('animate-slide-up');
      }, index * 200);
    });
  }
  
  private animateServices(): void {
    // Add staggered animation to service cards
    const cards = document.querySelectorAll('.service-card');
    cards.forEach((card, index) => {
      setTimeout(() => {
        card.classList.add('animate-scale-in');
      }, index * 150);
    });
  }
  
  // Testimonials carousel methods
  nextTestimonial(): void {
    if (this.photographer().clientTestimonials) {
      this.activeTestimonialIndex = 
        (this.activeTestimonialIndex + 1) % this.photographer().clientTestimonials.length;
      this.updateCarouselPosition();
    }
  }
  
  previousTestimonial(): void {
    if (this.photographer().clientTestimonials) {
      this.activeTestimonialIndex = 
        this.activeTestimonialIndex === 0 
          ? this.photographer().clientTestimonials.length - 1 
          : this.activeTestimonialIndex - 1;
      this.updateCarouselPosition();
    }
  }
  
  goToTestimonial(index: number): void {
    this.activeTestimonialIndex = index;
    this.updateCarouselPosition();
  }
  
  private updateCarouselPosition(): void {
    if (this.testimonialsTrack()) {
      const cardWidth = 400; // Approximate card width
      this.testimonialOffset = -this.activeTestimonialIndex * (cardWidth + 24); // 24px gap
      this.cdr.detectChanges();
    }
  }
    toggleTestimonialLike(index: number): void {
    if (this.photographer().clientTestimonials && this.photographer().clientTestimonials[index]) {
      const testimonial = this.photographer().clientTestimonials[index];
      // Инициализируем поля если их нет
      if (testimonial.liked === undefined) {
        testimonial.liked = false;
      }
      if (testimonial.likes === undefined) {
        testimonial.likes = 0;
      }
      testimonial.liked = !testimonial.liked;
      testimonial.likes = (testimonial.likes || 0) + (testimonial.liked ? 1 : -1);
    }
  }
  
  // Service interaction methods
  onServiceHover(index: number): void {
    // Add visual feedback for service hover
    const serviceCard = document.querySelectorAll('.service-card')[index];
    if (serviceCard) {
      serviceCard.classList.add('hovered');
    }
  }
  
  onServiceLeave(index: number): void {
    // Remove hover effects
    const serviceCard = document.querySelectorAll('.service-card')[index];
    if (serviceCard) {
      serviceCard.classList.remove('hovered');
    }
  }
    getServiceIcon(category?: string): string {
    if (!category) return 'photo_camera';
    
    const iconMap: Record<string, string> = {
      'portrait': 'person',
      'wedding': 'favorite',
      'family': 'family_restroom',
      'individual': 'face',
      'studio': 'photo_camera',
      'outdoor': 'landscape',
      'event': 'celebration',
      'commercial': 'business',
      'children': 'child_care',
      'maternity': 'pregnant_woman'
    };
    return iconMap[category] || 'photo_camera';
  }
    getBookingLink(service: PhotographerService): string {
    return `/booking/photographer/${this.photographer().id}?service=${service.id}`;
  }
  
  // Modal and interaction methods
  openPhotoModal(photo: { url: string; alt?: string }): void {
    // Open photo modal (implement modal service)
    this.log.debug('Opening photo modal:', photo);
  }
    openServiceDetails(service: PhotographerService): void {
    // Open service details modal
    this.log.debug('Opening service details:', service);
  }
  
  openGalleryModal(service: PhotographerService): void {
    // Open gallery modal for this service
    this.log.debug('Opening gallery for service:', service);
  }
  
  openFAQ(): void {
    // Open FAQ modal or navigate to FAQ page
    this.log.debug('Opening FAQ');
  }
  
  // Utility methods
  getStarArray(rating: number): number[] {
    return Array.from({ length: Math.floor(rating) }, (_, i) => i);
  }
}