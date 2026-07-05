import { TestBed } from '@angular/core/testing';
import { BreakpointObserver } from '@angular/cdk/layout';
import { ResponsiveLayoutService } from './responsive-layout.service';

describe('ResponsiveLayoutService', () => {
  let service: ResponsiveLayoutService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ResponsiveLayoutService,
        BreakpointObserver
      ]
    });
    service = TestBed.inject(ResponsiveLayoutService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
