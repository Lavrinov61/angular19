import { Component, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../../core/services/seo.service';
import { ScrollRevealDirective } from '../../../shared/directives/scroll-reveal.directive';
import { PhotographerService } from '../../../core/services/photographer.service';
import { TeamMember } from '../../photograph/models/photographer.model';

interface StudioLocation {
  name: string;
  address: string;
  hours: string;
  mapUrl: string;
}

@Component({
  selector: 'app-about',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, RouterLink, ScrollRevealDirective],
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss'
})
export class AboutComponent implements OnInit {
  private seoService = inject(SeoService);
  private photographerService = inject(PhotographerService);

  readonly team = signal<TeamMember[]>([]);

  readonly studios: StudioLocation[] = [
    {
      name: 'Студия на Соборном',
      address: 'пер. Соборный, 21',
      hours: 'Пн-Вс 09:00-19:30',
      mapUrl: 'https://yandex.ru/maps/-/CDa0rP'
    }
  ];

  readonly stats = [
    { value: `${new Date().getFullYear() - 1999}+`, label: 'лет опыта' },
    { value: '500+', label: 'отзывов' },
    { value: '1', label: 'студия' },
    { value: '20 000+', label: 'клиентов' }
  ];

  ngOnInit(): void {
    this.photographerService.getTeamMembers().subscribe(members => {
      this.team.set(members);
    });
    this.setupSeo();
  }

  private setupSeo(): void {
    const title = 'О нас, Своё Фото | Фотостудия в Ростове-на-Дону';
    const years = new Date().getFullYear() - 1999;
    const description = `Фотостудия Своё Фото, ${years} лет опыта, ручная художественная обработка каждого снимка. Студия в центре Ростова-на-Дону. 20 000+ довольных клиентов.`;
    const image = 'https://svoefoto.ru/static/about-svoe-foto.jpg';

    this.seoService.setAllMetaData(title, description, image);
    this.seoService.setLocalSeoMeta();
    this.seoService.setPhotographerJsonLd();
    this.seoService.setBreadcrumbJsonLd([
      { name: 'Главная', url: 'https://svoefoto.ru/' },
      { name: 'О нас', url: 'https://svoefoto.ru/about' }
    ]);
  }
}
