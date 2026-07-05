import {
  Directive,
  inject,
  input,
  effect,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';
import { AuthService } from '../../core/services/auth.service';

/**
 * Structural directive that conditionally renders content based on RBAC permissions.
 *
 * Usage:
 *   <button *appHasPermission="'settings:manage'">Admin only</button>
 *
 * Reads permissions reactively from AuthService.permissions signal -
 * view is created/destroyed automatically when permissions change.
 */
@Directive({
  selector: '[appHasPermission]',
})
export class HasPermissionDirective {
  readonly appHasPermission = input.required<string>();

  private readonly auth = inject(AuthService);
  private readonly templateRef = inject(TemplateRef);
  private readonly vcr = inject(ViewContainerRef);

  private hasView = false;

  constructor() {
    effect(() => {
      const granted = this.auth.hasPermission(this.appHasPermission());

      if (granted && !this.hasView) {
        this.vcr.createEmbeddedView(this.templateRef);
        this.hasView = true;
      } else if (!granted && this.hasView) {
        this.vcr.clear();
        this.hasView = false;
      }
    });
  }
}
