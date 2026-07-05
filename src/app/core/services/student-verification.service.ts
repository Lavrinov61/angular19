import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { StudentDiscountAccount } from './auth.service';

export type StudentAccountStatus = 'pending' | 'verified' | 'rejected' | 'expired' | 'revoked';
export type StudentVerificationStatus = 'pending' | 'pending_in_person' | 'approved' | 'rejected' | 'cancelled';
export type StudentVerificationFilter = StudentVerificationStatus | 'all';
export type StudentVerificationSource = 'online_upload' | 'in_person';
export type EducationRole = 'student' | 'applicant' | 'teacher' | 'lecturer' | 'staff';
export type EducationDocumentType =
  | 'student_card'
  | 'grade_book'
  | 'study_certificate'
  | 'teacher_id'
  | 'admission_document'
  | 'other';
export type StudentReferralChannel =
  | 'classmate'
  | 'friend'
  | 'social'
  | 'repeat_customer'
  | 'walk_in'
  | 'employee_told'
  | 'other';

export interface StudentAccount {
  id: string;
  user_id: string;
  status: StudentAccountStatus;
  education_role: EducationRole;
  institution_name: string | null;
  document_number: string | null;
  verified_at: string | null;
  expires_at: string | null;
  reviewer_id: string | null;
  reject_reason: string | null;
  revoke_reason: string | null;
  revoked_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudentVerification {
  id: string;
  account_id: string | null;
  user_id: string | null;
  status: StudentVerificationStatus;
  source: StudentVerificationSource;
  education_role: EducationRole;
  institution_name: string | null;
  document_type: EducationDocumentType | null;
  document_s3_key: string | null;
  document_url: string | null;
  document_mime_type: string | null;
  document_file_size: number;
  document_expires_at: string | null;
  phone_normalized: string | null;
  referral_channel: StudentReferralChannel | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_id: string | null;
  review_notes: string | null;
  rejection_reason: string | null;
  photo_deleted_at: string | null;
  retention_delete_after: string | null;
}

export interface StudentVerificationStatusPayload {
  account: StudentAccount | null;
  latest_verification: StudentVerification | null;
  student_discount: StudentDiscountAccount | null;
  discount: StudentDiscountAccount | null;
}

export interface StudentVerificationAdminItem extends StudentVerification {
  account_status: StudentAccountStatus | null;
  user_email: string | null;
  user_phone: string | null;
  user_display_name: string | null;
  user_date_of_birth: string | null;
  verified_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface InPersonMatchedUser {
  id: string;
  phone: string | null;
  display_name: string | null;
  email: string | null;
}

export interface PrepareInPersonStudentVerificationInput {
  phone: string;
  institutionName: string;
  educationRole: EducationRole;
  documentType: EducationDocumentType;
  documentExpiresAt: string;
  referralChannel: StudentReferralChannel;
  referrerPhone?: string | null;
  conversationId?: string | null;
}

export type ScheduledSendChannel =
  | 'telegram'
  | 'max'
  | 'vk'
  | 'whatsapp'
  | 'instagram'
  | 'sms'
  | 'none';

const SCHEDULED_SEND_CHANNELS: readonly ScheduledSendChannel[] = [
  'telegram',
  'max',
  'vk',
  'whatsapp',
  'instagram',
  'sms',
  'none',
];

export interface InPersonStudentVerificationPayload {
  verification: StudentVerification;
  matched_user: InPersonMatchedUser | null;
  scheduled_send_at: string | null;
  scheduled_send_channel: ScheduledSendChannel | null;
  /** Канал, в который ссылка УЖЕ отправлена в чат сейчас (web/telegram/…). null — не было. */
  sent_to_chat_channel: string | null;
}

export interface PresignedStudentVerificationUpload {
  s3Key: string;
  uploadUrl: string;
  contentType: string;
}

interface ApiSuccess<T> {
  success: true;
  data: T;
}

interface PresignResponse {
  uploads: PresignedStudentVerificationUpload[];
}

interface CompleteResponse {
  account: BackendStudentAccount | null;
  latest_verification: BackendStudentVerification | null;
  student_discount: StudentDiscountAccount | null;
}

interface ListResponse {
  items: BackendStudentVerificationAdminItem[];
}

interface InPersonPrepareResponse {
  verification: BackendStudentVerification;
  matched_user: InPersonMatchedUser | null;
  scheduled_send_at?: string | null;
  scheduled_send_channel?: string | null;
  sent_to_chat_channel?: string | null;
}

interface PendingInPersonResponse {
  verification: BackendStudentVerification | null;
}

interface BackendStudentAccount {
  id: string;
  user_id: string;
  status: StudentAccountStatus;
  education_role?: EducationRole | null;
  institution_name: string | null;
  document_number?: string | null;
  verified_at: string | null;
  expires_at: string | null;
  reviewer_id?: string | null;
  reject_reason?: string | null;
  revoke_reason?: string | null;
  created_at: string;
  updated_at: string;
}

interface BackendStudentVerification {
  id: string;
  account_id: string | null;
  user_id: string | null;
  status: StudentVerificationStatus;
  source?: StudentVerificationSource | null;
  education_role?: EducationRole | null;
  institution_name: string | null;
  document_type?: EducationDocumentType | null;
  document_expires_at: string | null;
  document_photo_key: string | null;
  document_url: string | null;
  document_photo_content_type: string | null;
  document_photo_size_bytes: number | string | null;
  phone_normalized?: string | null;
  referral_channel?: StudentReferralChannel | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewer_id: string | null;
  review_notes: string | null;
  reject_reason: string | null;
  photo_deleted_at: string | null;
  retention_delete_after: string | null;
}

interface BackendStudentVerificationAdminItem extends BackendStudentVerification {
  account_status: StudentAccountStatus | null;
  account_expires_at: string | null;
  user_email: string | null;
  user_phone: string | null;
  user_display_name: string | null;
  user_date_of_birth: string | null;
}

@Injectable({ providedIn: 'root' })
export class StudentVerificationService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/student-verifications';

  loadMine(): Observable<StudentVerificationStatusPayload> {
    return this.http
      .get<ApiSuccess<CompleteResponse>>(`${this.baseUrl}/me`)
      .pipe(map(response => this.toStatus(response.data)));
  }

  presign(file: File): Observable<PresignedStudentVerificationUpload> {
    return this.http
      .post<ApiSuccess<PresignResponse>>(`${this.baseUrl}/uploads/presign`, {
        files: [
          {
            fileName: file.name,
            contentType: file.type,
            fileSize: file.size,
          },
        ],
      })
      .pipe(
        map(response => {
          const upload = response.data.uploads[0];
          if (!upload) {
            throw new Error('Не удалось подготовить загрузку документа.');
          }
          return upload;
        }),
      );
  }

  uploadFile(upload: PresignedStudentVerificationUpload, file: File): Observable<unknown> {
    const headers = new HttpHeaders({ 'Content-Type': upload.contentType });
    return this.http.put(upload.uploadUrl, file, { headers, responseType: 'text' });
  }

  completeUpload(input: {
    upload: PresignedStudentVerificationUpload;
    file: File;
    institutionName: string;
    educationRole: EducationRole;
    documentExpiresAt?: string | null;
  }): Observable<StudentVerificationStatusPayload> {
    return this.http
      .post<ApiSuccess<CompleteResponse>>(`${this.baseUrl}/uploads/complete`, {
        files: [
          {
            s3Key: input.upload.s3Key,
            fileName: input.file.name,
            contentType: input.upload.contentType,
            fileSize: input.file.size,
          },
        ],
        education_role: input.educationRole,
        institution_name: input.institutionName,
        document_expires_at: input.documentExpiresAt || null,
      })
      .pipe(map(response => this.toStatus(response.data)));
  }

  listAdmin(status: StudentVerificationFilter, limit = 100): Observable<StudentVerificationAdminItem[]> {
    return this.http
      .get<ApiSuccess<ListResponse>>(`${this.baseUrl}/admin`, {
        params: { status, limit },
      })
      .pipe(map(response => response.data.items.map(item => this.toAdminItem(item))));
  }

  approve(
    id: string,
    input: { expiresAt: string; reviewNotes?: string | null },
  ): Observable<StudentVerificationStatusPayload> {
    return this.http
      .post<ApiSuccess<CompleteResponse>>(`${this.baseUrl}/admin/${id}/approve`, {
        expires_at: input.expiresAt,
        review_notes: input.reviewNotes || null,
      })
      .pipe(map(response => this.toStatus(response.data)));
  }

  reject(
    id: string,
    input: { reason: string; reviewNotes?: string | null },
  ): Observable<StudentVerificationStatusPayload> {
    return this.http
      .post<ApiSuccess<CompleteResponse>>(`${this.baseUrl}/admin/${id}/reject`, {
        reason: input.reason,
        review_notes: input.reviewNotes || null,
      })
      .pipe(map(response => this.toStatus(response.data)));
  }

  revoke(accountId: string, reason: string): Observable<StudentVerificationStatusPayload> {
    return this.http
      .post<ApiSuccess<CompleteResponse>>(`${this.baseUrl}/admin/accounts/${accountId}/revoke`, {
        reason,
      })
      .pipe(map(response => this.toStatus(response.data)));
  }

  prepareInPerson(input: PrepareInPersonStudentVerificationInput): Observable<InPersonStudentVerificationPayload> {
    return this.http
      .post<ApiSuccess<InPersonPrepareResponse>>(`${this.baseUrl}/admin/in-person/prepare`, {
        phone: input.phone,
        institution_name: input.institutionName,
        education_role: input.educationRole,
        document_type: input.documentType,
        document_expires_at: input.documentExpiresAt,
        referral_channel: input.referralChannel,
        referrer_phone: input.referrerPhone ?? null,
        conversation_id: input.conversationId ?? null,
      })
      .pipe(
        map(response => ({
          verification: this.toRequiredVerification(response.data.verification),
          matched_user: response.data.matched_user,
          scheduled_send_at: response.data.scheduled_send_at ?? null,
          scheduled_send_channel: this.toScheduledSendChannel(response.data.scheduled_send_channel),
          sent_to_chat_channel: response.data.sent_to_chat_channel ?? null,
        })),
      );
  }

  lookupInPerson(phone: string): Observable<InPersonMatchedUser | null> {
    return this.http
      .get<ApiSuccess<{ matched_user: InPersonMatchedUser | null }>>(`${this.baseUrl}/admin/in-person/lookup`, {
        params: { phone },
      })
      .pipe(map(response => response.data.matched_user));
  }

  loadPendingInPerson(): Observable<StudentVerification | null> {
    return this.http
      .get<ApiSuccess<PendingInPersonResponse>>(`${this.baseUrl}/in-person/pending`)
      .pipe(map(response => this.toVerification(response.data.verification)));
  }

  confirmInPerson(
    id: string,
    input: { consentVersion: string; marketingConsent?: boolean },
  ): Observable<StudentVerificationStatusPayload> {
    return this.http
      .post<ApiSuccess<CompleteResponse>>(`${this.baseUrl}/in-person/${id}/confirm`, {
        consent_version: input.consentVersion,
        marketing_consent: input.marketingConsent ?? false,
      })
      .pipe(map(response => this.toStatus(response.data)));
  }

  withdrawInPersonConsent(reason?: string | null): Observable<StudentVerificationStatusPayload> {
    return this.http
      .post<ApiSuccess<CompleteResponse>>(`${this.baseUrl}/in-person/withdraw`, {
        reason: reason ?? null,
      })
      .pipe(map(response => this.toStatus(response.data)));
  }

  private toStatus(payload: CompleteResponse): StudentVerificationStatusPayload {
    return {
      account: this.toAccount(payload.account),
      latest_verification: this.toVerification(payload.latest_verification),
      student_discount: payload.student_discount,
      discount: payload.student_discount,
    };
  }

  private toAccount(account: BackendStudentAccount | null): StudentAccount | null {
    if (!account) return null;
    return {
      id: account.id,
      user_id: account.user_id,
      status: account.status,
      education_role: account.education_role ?? 'student',
      institution_name: account.institution_name,
      document_number: account.document_number ?? null,
      verified_at: account.verified_at,
      expires_at: account.expires_at,
      reviewer_id: account.reviewer_id ?? null,
      reject_reason: account.reject_reason ?? null,
      revoke_reason: account.revoke_reason ?? null,
      revoked_reason: account.revoke_reason ?? null,
      created_at: account.created_at,
      updated_at: account.updated_at,
    };
  }

  private toVerification(verification: BackendStudentVerification | null): StudentVerification | null {
    if (!verification) return null;
    return {
      id: verification.id,
      account_id: verification.account_id,
      user_id: verification.user_id,
      status: verification.status,
      source: verification.source ?? 'online_upload',
      education_role: verification.education_role ?? 'student',
      institution_name: verification.institution_name,
      document_type: verification.document_type ?? null,
      document_s3_key: verification.document_photo_key,
      document_url: verification.document_url,
      document_mime_type: verification.document_photo_content_type,
      document_file_size: Number(verification.document_photo_size_bytes) || 0,
      document_expires_at: verification.document_expires_at,
      phone_normalized: verification.phone_normalized ?? null,
      referral_channel: verification.referral_channel ?? null,
      submitted_at: verification.submitted_at,
      reviewed_at: verification.reviewed_at,
      reviewer_id: verification.reviewer_id,
      review_notes: verification.review_notes,
      rejection_reason: verification.reject_reason,
      photo_deleted_at: verification.photo_deleted_at,
      retention_delete_after: verification.retention_delete_after,
    };
  }

  private toRequiredVerification(verification: BackendStudentVerification): StudentVerification {
    const mapped = this.toVerification(verification);
    if (!mapped) {
      throw new Error('Student verification item is required.');
    }
    return mapped;
  }

  private toScheduledSendChannel(value: string | null | undefined): ScheduledSendChannel | null {
    if (value && (SCHEDULED_SEND_CHANNELS as readonly string[]).includes(value)) {
      return value as ScheduledSendChannel;
    }
    return null;
  }

  private toAdminItem(item: BackendStudentVerificationAdminItem): StudentVerificationAdminItem {
    const verification = this.toRequiredVerification(item);
    return {
      ...verification,
      account_status: item.account_status,
      user_email: item.user_email,
      user_phone: item.user_phone,
      user_display_name: item.user_display_name,
      user_date_of_birth: item.user_date_of_birth ?? null,
      verified_at: null,
      expires_at: item.account_expires_at,
      revoked_at: null,
    };
  }
}
