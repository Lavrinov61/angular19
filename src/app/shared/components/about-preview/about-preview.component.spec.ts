import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { AboutPreviewComponent, AboutData } from './about-preview.component';

describe('AboutPreviewComponent', () => {
  let component: AboutPreviewComponent;
  let fixture: ComponentFixture<AboutPreviewComponent>;

  const testAboutData: AboutData = {
    textParts: {
      highlight: 'Test Highlight',
      main: ['Test main paragraph'],
      keywords: ['test', 'keywords']
    },
    features: [
      {
        icon: 'star',
        title: 'Test Feature',
        description: 'Test description'
      }
    ],
    buttons: [
      {
        label: 'Test Button',
        href: '/test',
        variant: 'primary'
      }
    ]
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AboutPreviewComponent],
      providers: [
        provideHttpClient(),
        provideRouter([])
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AboutPreviewComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('aboutData', testAboutData);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
