import { describe, it, expect } from 'vitest';
import {
  calculateStudentIdPhotoPromoForItem,
  isStudentIdPhotoPromoTarget,
  STUDENT_ID_PHOTO_PROMO_PACK_QTY,
  STUDENT_ID_PHOTO_PROMO_UNIT_PRICE,
  type StudentIdPhotoPromoState,
} from './student-id-photo-promo.service.js';

const AVAILABLE: StudentIdPhotoPromoState = {
  studentAccountId: 'acc-1',
  userId: 'user-1',
  available: true,
  periodKey: 'lifetime',
  isSubscriber: false,
};

describe('isStudentIdPhotoPromoTarget', () => {
  it('matches by slug photo-student', () => {
    expect(isStudentIdPhotoPromoTarget('photo-student', 'что угодно')).toBe(true);
    expect(isStudentIdPhotoPromoTarget('PHOTO-STUDENT', '')).toBe(true);
  });

  it('matches by name «фото на студенческий» (ё-insensitive)', () => {
    expect(isStudentIdPhotoPromoTarget('other-slug', 'Фото на студенческий')).toBe(true);
    expect(isStudentIdPhotoPromoTarget(null, 'фото на студенческий билет')).toBe(true);
  });

  it('does not match unrelated services', () => {
    expect(isStudentIdPhotoPromoTarget('photo-passport', 'Фото на паспорт')).toBe(false);
    expect(isStudentIdPhotoPromoTarget('copy-a4-bw', 'Ксерокопия А4')).toBe(false);
  });
});

describe('calculateStudentIdPhotoPromoForItem', () => {
  const base = {
    slug: 'photo-student',
    name: 'Фото на студенческий',
    basePrice: 700,
    quantity: STUDENT_ID_PHOTO_PROMO_PACK_QTY,
  };

  it('prices the full pack at unit price when qty equals pack size', () => {
    const pricing = calculateStudentIdPhotoPromoForItem({ state: AVAILABLE, ...base });
    expect(pricing).not.toBeNull();
    expect(pricing!.units).toBe(STUDENT_ID_PHOTO_PROMO_PACK_QTY);
    expect(pricing!.unitPrice).toBe(STUDENT_ID_PHOTO_PROMO_UNIT_PRICE);
    expect(pricing!.total).toBe(STUDENT_ID_PHOTO_PROMO_UNIT_PRICE * STUDENT_ID_PHOTO_PROMO_PACK_QTY);
    // экономия = (700 - 200) * 4 = 2000
    expect(pricing!.discountAmount).toBe((700 - STUDENT_ID_PHOTO_PROMO_UNIT_PRICE) * STUDENT_ID_PHOTO_PROMO_PACK_QTY);
  });

  it('does not apply when quantity differs from pack size (ни больше ни меньше)', () => {
    expect(calculateStudentIdPhotoPromoForItem({ state: AVAILABLE, ...base, quantity: 1 })).toBeNull();
    expect(calculateStudentIdPhotoPromoForItem({ state: AVAILABLE, ...base, quantity: STUDENT_ID_PHOTO_PROMO_PACK_QTY + 1 })).toBeNull();
  });

  it('does not apply when promo already used (available=false)', () => {
    const used: StudentIdPhotoPromoState = { ...AVAILABLE, available: false };
    expect(calculateStudentIdPhotoPromoForItem({ state: used, ...base })).toBeNull();
  });

  it('applies the same pack for a subscriber window (period key not lifetime)', () => {
    const subscriber: StudentIdPhotoPromoState = {
      ...AVAILABLE,
      periodKey: '2026-06-01',
      isSubscriber: true,
    };
    const pricing = calculateStudentIdPhotoPromoForItem({ state: subscriber, ...base });
    expect(pricing).not.toBeNull();
    expect(pricing!.total).toBe(STUDENT_ID_PHOTO_PROMO_UNIT_PRICE * STUDENT_ID_PHOTO_PROMO_PACK_QTY);
  });

  it('does not apply without an eligible educational account (state null)', () => {
    expect(calculateStudentIdPhotoPromoForItem({ state: null, ...base })).toBeNull();
  });

  it('does not apply to non-target services', () => {
    expect(
      calculateStudentIdPhotoPromoForItem({ state: AVAILABLE, ...base, slug: 'photo-passport', name: 'Фото на паспорт' }),
    ).toBeNull();
  });

  it('does not apply when base price is not above promo price', () => {
    expect(
      calculateStudentIdPhotoPromoForItem({ state: AVAILABLE, ...base, basePrice: STUDENT_ID_PHOTO_PROMO_UNIT_PRICE }),
    ).toBeNull();
  });
});
