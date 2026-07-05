import { Injectable, inject, OnDestroy } from '@angular/core';
import { WebSocketService } from '../../../core/services/websocket.service';

@Injectable({ providedIn: 'root' })
export class InfraRealtimeService implements OnDestroy {
  private readonly ws = inject(WebSocketService);

  /** Proxy signals from WebSocketService for convenience. */
  readonly lastHeartbeat = this.ws.infraHeartbeat;
  readonly lastAlert = this.ws.infraAlert;
  readonly lastTelemetry = this.ws.infraSystemTelemetry;
  readonly alertCount = this.ws.infraAlertCount;
  readonly updateProgress = this.ws.infraUpdateProgress;
  readonly printerStatus = this.ws.infraPrinterStatus;
  readonly securityEvent = this.ws.infraSecurityEvent;
  readonly printJobUpdate = this.ws.printJobUpdate;
  readonly posTransactionUpdate = this.ws.posTransactionUpdate;
  readonly activePrintJobs = this.ws.activePrintJobs;
  readonly printQueuePaused = this.ws.printQueuePaused;
  readonly printQueueResumed = this.ws.printQueueResumed;
  readonly printJobSplit = this.ws.printJobSplit;
  readonly printSupplyAlert = this.ws.printSupplyAlert;
  readonly printCopyProgress = this.ws.printCopyProgress;

  private subscriptionRefs = 0;

  requestPrintSync(): void {
    this.ws.requestPrintSync();
  }

  subscribe(): void {
    this.subscriptionRefs += 1;
    if (this.subscriptionRefs > 1) return;
    this.ws.joinInfraMonitoring();
  }

  unsubscribe(): void {
    if (this.subscriptionRefs === 0) return;
    this.subscriptionRefs -= 1;
    if (this.subscriptionRefs > 0) return;
    this.ws.leaveInfraMonitoring();
  }

  ngOnDestroy(): void {
    if (this.subscriptionRefs === 0) return;
    this.subscriptionRefs = 0;
    this.ws.leaveInfraMonitoring();
  }
}
