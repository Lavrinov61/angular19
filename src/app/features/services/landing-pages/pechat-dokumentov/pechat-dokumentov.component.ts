import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SeoService } from '../../../../core/services/seo.service';
import { ScrollRevealDirective } from '../../../../shared/directives/scroll-reveal.directive';
import { TrackClickDirective } from '../../../../shared/directives/track-click.directive';
import { DocumentPrintOrderWidgetComponent } from './components/document-print-order-widget/document-print-order-widget.component';

interface DocumentMetric {
  readonly icon: string;
  readonly value: string;
  readonly label: string;
}

interface DocumentStep {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
}

interface DocumentFaq {
  readonly question: string;
  readonly answer: string;
}

@Component({
  selector: 'app-pechat-dokumentov',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    ScrollRevealDirective,
    TrackClickDirective,
    DocumentPrintOrderWidgetComponent,
  ],
  templateUrl: './pechat-dokumentov.component.html',
  styleUrl: './pechat-dokumentov.component.scss',
})
export class PechatDokumentovComponent implements OnInit {
  private readonly seo = inject(SeoService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  protected readonly metrics: readonly DocumentMetric[] = [
    { icon: 'description', value: 'PDF, Word, Excel', label: 'загрузка прямо в заказ' },
    { icon: 'storefront', value: 'студия', label: 'самовывоз в центре Ростова' },
    { icon: 'person_off', value: 'без входа', label: 'кабинет можно подключить после' },
  ];

  protected readonly steps: readonly DocumentStep[] = [
    {
      icon: 'upload_file',
      title: 'Загружаете файлы',
      description: 'Документы уходят в заказ сразу через прямую загрузку, без авторизации.',
    },
    {
      icon: 'tune',
      title: 'Выбираете печать',
      description: 'Формат, цветность, стороны, экземпляры и скрепление.',
    },
    {
      icon: 'call',
      title: 'Оставляете контакты',
      description: 'Нужны точка самовывоза, имя и телефон для уточнения заказа.',
    },
    {
      icon: 'receipt_long',
      title: 'Получаете заказ',
      description: 'После создания можно оплатить онлайн или связаться со студией.',
    },
  ];

  protected readonly faqs: readonly DocumentFaq[] = [
    {
      question: 'Нужно входить в личный кабинет?',
      answer: 'Нет. Загрузить файлы и создать заказ можно как гость. Вход нужен только для истории и статуса заказа.',
    },
    {
      question: 'Можно прийти без файла на сайте?',
      answer: 'Да. Можно приехать с телефоном, флешкой или бумажными документами, но онлайн-заказ быстрее передаёт параметры сотруднику.',
    },
    {
      question: 'Что если страниц в файле больше или меньше?',
      answer: 'Перед печатью сотрудник проверит файл, количество страниц и итоговую сумму.',
    },
  ];

  ngOnInit(): void {
    const title = 'Печать документов А4 и А3 в Ростове | Своё Фото';
    const description = 'Печать документов без входа в кабинет: загрузите PDF, Word, Excel или изображения, выберите параметры, оставьте телефон и заберите заказ в студии.';
    const url = 'https://svoefoto.ru/pechat-dokumentov';
    const image = 'https://svoefoto.ru/assets/static/promo/pechat-dokumentov.webp';

    this.seo.updateTitle(title);
    this.seo.updateDescription(description);
    this.seo.updateCanonicalUrl('/pechat-dokumentov');
    this.seo.setOpenGraph(title, description, image, 'website', url);
  }

  protected scrollToOrder(event?: Event): void {
    event?.preventDefault();
    if (!isPlatformBrowser(this.platformId)) return;

    const windowRef = this.document.defaultView;
    const target = this.document.getElementById('document-order');
    const scrollHost = this.document.querySelector('mat-sidenav-content');
    if (!windowRef || !target) return;

    if (scrollHost instanceof windowRef.HTMLElement) {
      const hostRect = scrollHost.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const offset = windowRef.innerWidth <= 720 ? 116 : 132;
      const top = scrollHost.scrollTop + targetRect.top - hostRect.top - offset;
      scrollHost.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      return;
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
