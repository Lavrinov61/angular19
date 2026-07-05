import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  AddPhotoWorkspaceReferenceBody,
  AddPhotoWorkspaceWishBody,
  CompletePhotoWorkspacePhotoshopBody,
  CreatePhotoWorkspaceItemBody,
  PhotoWorkspaceApiResponse,
  PhotoWorkspaceItemDto,
  PhotoWorkspaceJournalDto,
  PhotoWorkspaceOrderDto,
  PhotoWorkspaceReferenceDto,
  PhotoWorkspaceVariantDto,
  PhotoWorkspaceWishDto,
  RebuildPhotoWorkspacePromptPlanBody,
  SavePhotoWorkspaceCropBody,
  SetPhotoWorkspaceVariantCheckedBody,
  UpdatePhotoWorkspaceItemBody,
  UpdatePhotoWorkspaceReferenceBody,
  UpdatePhotoWorkspaceVariantPromptBody,
  UpdatePhotoWorkspaceWishBody,
} from '../models/photo-workspace.model';

export interface PhotoWorkspacePresignUpload {
  s3Key: string;
  uploadUrl: string;
  contentType: string;
}

export interface PhotoWorkspacePresignUploadResponse {
  uploads: PhotoWorkspacePresignUpload[];
}

@Injectable({ providedIn: 'root' })
export class PhotoWorkspaceApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/photo-workspace';

  getOrderWorkspace(orderId: string): Observable<PhotoWorkspaceApiResponse<PhotoWorkspaceOrderDto>> {
    return this.http.get<PhotoWorkspaceApiResponse<PhotoWorkspaceOrderDto>>(`${this.baseUrl}/orders/${encodePath(orderId)}`);
  }

  createItem(orderId: string, body: CreatePhotoWorkspaceItemBody): Observable<PhotoWorkspaceApiResponse<PhotoWorkspaceItemDto>> {
    return this.http.post<PhotoWorkspaceApiResponse<PhotoWorkspaceItemDto>>(
      `${this.baseUrl}/orders/${encodePath(orderId)}/items`,
      body,
    );
  }

  updateItem(itemId: string, body: UpdatePhotoWorkspaceItemBody): Observable<PhotoWorkspaceApiResponse<PhotoWorkspaceItemDto>> {
    return this.http.patch<PhotoWorkspaceApiResponse<PhotoWorkspaceItemDto>>(
      `${this.baseUrl}/items/${encodePath(itemId)}`,
      body,
    );
  }

  saveCrop(itemId: string, body: SavePhotoWorkspaceCropBody): Observable<PhotoWorkspaceApiResponse<PhotoWorkspaceItemDto>> {
    return this.http.put<PhotoWorkspaceApiResponse<PhotoWorkspaceItemDto>>(
      `${this.baseUrl}/items/${encodePath(itemId)}/crop`,
      body,
    );
  }

  runCrop(itemId: string): Observable<PhotoWorkspaceApiResponse<PhotoWorkspaceItemDto>> {
    return this.http.post<PhotoWorkspaceApiResponse<PhotoWorkspaceItemDto>>(
      `${this.baseUrl}/items/${encodePath(itemId)}/crop/run`,
      {},
    );
  }

  addReference(itemId: string, body: AddPhotoWorkspaceReferenceBody): Observable<PhotoWorkspaceApiResponse<PhotoWorkspaceReferenceDto>> {
    return this.http.post<PhotoWorkspaceApiResponse<PhotoWorkspaceReferenceDto>>(
      `${this.baseUrl}/items/${encodePath(itemId)}/references`,
      body,
    );
  }

  updateReference(referenceId: string, body: UpdatePhotoWorkspaceReferenceBody): Observable<PhotoWorkspaceApiResponse<PhotoWorkspaceReferenceDto>> {
    return this.http.patch<PhotoWorkspaceApiResponse<PhotoWorkspaceReferenceDto>>(
      `${this.baseUrl}/references/${encodePath(referenceId)}`,
      body,
    );
  }

  deleteReference(referenceId: string): Observable<PhotoWorkspaceApiResponse<{ deleted: boolean }>> {
    return this.http.delete<PhotoWorkspaceApiResponse<{ deleted: boolean }>>(
      `${this.baseUrl}/references/${encodePath(referenceId)}`,
    );
  }

  addWish(itemId: string, body: AddPhotoWorkspaceWishBody): Observable<PhotoWorkspaceApiResponse<PhotoWorkspaceWishDto>> {
    return this.http.post<PhotoWorkspaceApiResponse<PhotoWorkspaceWishDto>>(
      `${this.baseUrl}/items/${encodePath(itemId)}/wishes`,
      body,
    );
  }

  importApprovalFeedback(itemId: string): Observable<PhotoWorkspaceApiResponse<PhotoWorkspaceWishDto[]>> {
    return this.http.post<PhotoWorkspaceApiResponse<PhotoWorkspaceWishDto[]>>(
      `${this.baseUrl}/items/${encodePath(itemId)}/wishes/import-approval-feedback`,
      {},
    );
  }

  updateWish(wishId: string, body: UpdatePhotoWorkspaceWishBody): Observable<PhotoWorkspaceApiResponse<PhotoWorkspaceWishDto>> {
    return this.http.patch<PhotoWorkspaceApiResponse<PhotoWorkspaceWishDto>>(
      `${this.baseUrl}/wishes/${encodePath(wishId)}`,
      body,
    );
  }

  rebuildPromptPlan(itemId: string, body: RebuildPhotoWorkspacePromptPlanBody): Observable<PhotoWorkspaceApiResponse<PhotoWorkspaceVariantDto[]>> {
    return this.http.post<PhotoWorkspaceApiResponse<PhotoWorkspaceVariantDto[]>>(
      `${this.baseUrl}/items/${encodePath(itemId)}/prompt-plan/rebuild`,
      body,
    );
  }

  updateVariantPrompt(variantId: string, body: UpdatePhotoWorkspaceVariantPromptBody): Observable<PhotoWorkspaceApiResponse<PhotoWorkspaceVariantDto>> {
    return this.http.patch<PhotoWorkspaceApiResponse<PhotoWorkspaceVariantDto>>(
      `${this.baseUrl}/variants/${encodePath(variantId)}/prompt`,
      body,
    );
  }

  runAi(itemId: string): Observable<PhotoWorkspaceApiResponse<{ completed: number; failed: number }>> {
    return this.http.post<PhotoWorkspaceApiResponse<{ completed: number; failed: number }>>(
      `${this.baseUrl}/items/${encodePath(itemId)}/ai/run`,
      {},
    );
  }

  retryAiVariant(variantId: string): Observable<PhotoWorkspaceApiResponse<PhotoWorkspaceVariantDto>> {
    return this.http.post<PhotoWorkspaceApiResponse<PhotoWorkspaceVariantDto>>(
      `${this.baseUrl}/variants/${encodePath(variantId)}/ai/retry`,
      {},
    );
  }

  downloadAiArchive(itemId: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/items/${encodePath(itemId)}/ai/archive`, {
      responseType: 'blob',
    });
  }

  completePhotoshopUpload(
    variantId: string,
    body: CompletePhotoWorkspacePhotoshopBody,
  ): Observable<PhotoWorkspaceApiResponse<PhotoWorkspaceVariantDto>> {
    return this.http.post<PhotoWorkspaceApiResponse<PhotoWorkspaceVariantDto>>(
      `${this.baseUrl}/variants/${encodePath(variantId)}/photoshop`,
      body,
    );
  }

  setChecked(
    variantId: string,
    body: SetPhotoWorkspaceVariantCheckedBody,
  ): Observable<PhotoWorkspaceApiResponse<PhotoWorkspaceVariantDto>> {
    return this.http.patch<PhotoWorkspaceApiResponse<PhotoWorkspaceVariantDto>>(
      `${this.baseUrl}/variants/${encodePath(variantId)}/check`,
      body,
    );
  }

  sendVerified(itemId: string): Observable<PhotoWorkspaceApiResponse<{ sent: boolean }>> {
    return this.http.post<PhotoWorkspaceApiResponse<{ sent: boolean }>>(
      `${this.baseUrl}/items/${encodePath(itemId)}/send-verified`,
      {},
    );
  }

  replaceApprovalFile(
    variantId: string,
    body: CompletePhotoWorkspacePhotoshopBody,
  ): Observable<PhotoWorkspaceApiResponse<{ replaced: boolean }>> {
    return this.http.put<PhotoWorkspaceApiResponse<{ replaced: boolean }>>(
      `${this.baseUrl}/variants/${encodePath(variantId)}/approval-file`,
      body,
    );
  }

  deleteApprovalFile(variantId: string): Observable<PhotoWorkspaceApiResponse<{ deleted: boolean }>> {
    return this.http.delete<PhotoWorkspaceApiResponse<{ deleted: boolean }>>(
      `${this.baseUrl}/variants/${encodePath(variantId)}/approval-file`,
    );
  }

  getJournal(itemId: string): Observable<PhotoWorkspaceApiResponse<PhotoWorkspaceJournalDto[]>> {
    return this.http.get<PhotoWorkspaceApiResponse<PhotoWorkspaceJournalDto[]>>(
      `${this.baseUrl}/items/${encodePath(itemId)}/journal`,
    );
  }

  presignPhotoshopUpload(file: File): Observable<PhotoWorkspaceApiResponse<PhotoWorkspacePresignUploadResponse>> {
    return this.http.post<PhotoWorkspaceApiResponse<PhotoWorkspacePresignUploadResponse>>(
      '/api/photo-approvals/direct-upload/presign',
      {
        files: [{
          fileName: file.name,
          contentType: file.type || 'image/jpeg',
          fileSize: file.size,
        }],
      },
    );
  }

  uploadPresignedFile(uploadUrl: string, file: File, onProgress?: (percent: number) => void): Promise<void> {
    if (typeof XMLHttpRequest === 'undefined') {
      return Promise.reject(new Error('Browser upload is unavailable'));
    }

    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) {
          onProgress?.(Math.round((event.loaded / event.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        reject(new Error(`S3 PUT ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('S3 PUT network error'));
      xhr.send(file);
    });
  }
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}
