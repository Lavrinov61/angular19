import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAccountDiscountProfile,
  createEducationVerifiedOnlyProfile,
  resolveAccountDiscountProfile,
  resolveAccountItemDiscount,
} from './account-discounts.service.js';
import type { UsersId } from '../types/generated/public/Users.js';
import type { AccountDiscountUserRow } from '../types/views/account-discount-views.js';

const dbMock = vi.hoisted(() => ({
  queryOne: vi.fn(),
}));

vi.mock('../database/db.js', () => ({
  default: dbMock,
}));

const testUserId = '00000000-0000-0000-0000-000000000001' as UsersId;

function createUserRow(overrides: Partial<AccountDiscountUserRow> = {}): AccountDiscountUserRow {
  return {
    id: testUserId,
    phone: '79990000000',
    account_type: 'personal',
    personal_data: null,
    preferences: null,
    ...overrides,
  };
}

describe('account item discount rules', () => {
  beforeEach(() => {
    dbMock.queryOne.mockReset();
  });

  it('gives education accounts 70 percent on A4 document print fill tiers', () => {
    const profile = createAccountDiscountProfile('education', 'education_verification');

    const discount = resolveAccountItemDiscount(profile, {
      slug: 'km-а4-печать-документа',
      name: 'А4 Печать до 15%',
      categorySlug: 'copy-print',
      groupSlug: 'copy-print-items',
    });

    expect(discount).toMatchObject({
      kind: 'document_print',
      percent: 70,
    });
    expect(Math.round(10 * (1 - (discount?.percent ?? 0) / 100))).toBe(3);
  });

  it('uses separate document and photo discounts for each account type', () => {
    const personal = createAccountDiscountProfile('personal', 'explicit');
    const business = createAccountDiscountProfile('business', 'explicit');
    const education = createAccountDiscountProfile('education', 'education_verification');

    const documentTarget = {
      slug: 'km-а4-фото-документ',
      name: 'А4 Печать до 100%',
      categorySlug: 'copy-print',
      groupSlug: 'copy-print-items',
    };
    const photoTarget = {
      slug: 'km-фото-20x30-премиум',
      name: 'Фото 20x30 премиум',
      categorySlug: 'photo-print-format',
      groupSlug: 'photo-formats',
    };

    expect(resolveAccountItemDiscount(personal, documentTarget)?.percent).toBe(20);
    expect(resolveAccountItemDiscount(personal, photoTarget)?.percent).toBe(10);
    expect(resolveAccountItemDiscount(business, documentTarget)?.percent).toBe(40);
    expect(resolveAccountItemDiscount(business, photoTarget)?.percent).toBe(15);
    expect(resolveAccountItemDiscount(education, documentTarget)?.percent).toBe(70);
    expect(resolveAccountItemDiscount(education, photoTarget)?.percent).toBe(50);
  });

  it('excludes "super" photo formats from the education discount but keeps them for personal/business', () => {
    const personal = createAccountDiscountProfile('personal', 'explicit');
    const business = createAccountDiscountProfile('business', 'explicit');
    const education = createAccountDiscountProfile('education', 'education_verification');

    const superTargets = [
      {
        slug: 'km-фото-20x30-супер',
        name: 'Фото 20x30 супер',
        categorySlug: 'photo-print-format',
        groupSlug: 'photo-formats',
      },
      {
        slug: 'portrait-15x20-super',
        name: 'Портрет 15x20 super',
        categorySlug: 'photo-print-format',
        groupSlug: 'portrait-format',
      },
    ];

    for (const target of superTargets) {
      // Студентам на «супер» скидки нет.
      expect(resolveAccountItemDiscount(education, target)).toBeNull();
      // Личный/бизнес аккаунты скидку на «супер» сохраняют.
      expect(resolveAccountItemDiscount(personal, target)?.percent).toBe(10);
      expect(resolveAccountItemDiscount(business, target)?.percent).toBe(15);
    }

    // «Премиум» того же формата студенту по-прежнему даёт 50%.
    expect(resolveAccountItemDiscount(education, {
      slug: 'km-фото-20x30-премиум',
      name: 'Фото 20x30 премиум',
      categorySlug: 'photo-print-format',
      groupSlug: 'photo-formats',
    })?.percent).toBe(50);
  });

  it('gives the verified-only (no-subscription) education tier 50 percent docs and 30 percent photos', () => {
    const profile = createEducationVerifiedOnlyProfile();
    expect(profile.accountType).toBe('education');
    expect(profile.source).toBe('education_verified_only');

    const documentTarget = {
      slug: 'km-а4-печать-документа',
      name: 'А4 Печать до 15%',
      categorySlug: 'copy-print',
      groupSlug: 'copy-print-items',
    };
    const photoTarget = {
      slug: 'km-фото-10x15-премиум',
      name: 'Фото 10x15 премиум',
      categorySlug: 'photo-print-format',
      groupSlug: 'photo-formats',
    };

    expect(resolveAccountItemDiscount(profile, documentTarget)?.percent).toBe(50);
    expect(resolveAccountItemDiscount(profile, photoTarget)?.percent).toBe(30);
    // 10 ₽ база А4 ч/б → 5 ₽; 19.50 ₽ фото 10x15 → 13.65 ₽ (в маркетинге «от 14 ₽»).
    expect(Math.round(10 * (1 - 50 / 100))).toBe(5);

    // «Супер»-фото исключены и для тарифа «без подписки» (accountType='education').
    expect(resolveAccountItemDiscount(profile, {
      slug: 'km-фото-20x30-супер',
      name: 'Фото 20x30 супер',
      categorySlug: 'photo-print-format',
      groupSlug: 'photo-formats',
    })).toBeNull();
  });

  it('applies photo discounts to the Polaroid-style POS photo option', () => {
    const profile = createAccountDiscountProfile('personal', 'explicit');

    const discount = resolveAccountItemDiscount(profile, {
      slug: 'km-в-стиле-полароид',
      name: 'В стиле Полароид',
      categorySlug: 'photo-print-format',
      groupSlug: 'photo-formats',
    });

    expect(discount).toMatchObject({
      kind: 'photo_print',
      percent: 10,
    });
  });

  it('does not apply account discounts to binding, document photos, or photo formats larger than A4', () => {
    const profile = createAccountDiscountProfile('education', 'education_verification');

    expect(resolveAccountItemDiscount(profile, {
      slug: 'binding-spring-a4',
      name: 'Переплёт пружиной А4',
      categorySlug: 'copy-print',
      groupSlug: 'binding',
    })).toBeNull();
    expect(resolveAccountItemDiscount(profile, {
      slug: 'processing-basic',
      name: 'Фото на документы онлайн',
      categorySlug: 'photo-docs',
      groupSlug: 'processing',
    })).toBeNull();
    expect(resolveAccountItemDiscount(profile, {
      slug: 'km-фото-30x40-премиум',
      name: 'Фото 30x40 премиум',
      categorySlug: 'photo-print-format',
      groupSlug: 'photo-formats',
    })).toBeNull();
  });

  it('does not activate personal account discounts without a 199 monthly subscription', async () => {
    dbMock.queryOne
      .mockResolvedValueOnce(createUserRow({ account_type: 'personal' }))
      .mockResolvedValueOnce({ has: false })
      .mockResolvedValueOnce({ has: false });

    const profile = await resolveAccountDiscountProfile({ userId: testUserId });

    expect(profile.source).toBe('none');
    expect(profile.documentPrintDiscountPercent).toBe(0);
    expect(dbMock.queryOne.mock.calls[2]?.[1]).toEqual([
      testUserId,
      '79990000000',
      'doc-print',
      'monthly',
      null,
      199,
    ]);
  });

  it('activates business account discounts with a 199 monthly print subscription', async () => {
    dbMock.queryOne
      .mockResolvedValueOnce(createUserRow({ account_type: 'business' }))
      .mockResolvedValueOnce({ has: false })
      .mockResolvedValueOnce({ has: true });

    const profile = await resolveAccountDiscountProfile({ userId: testUserId });

    expect(profile.accountType).toBe('business');
    expect(profile.source).toBe('explicit');
    expect(profile.documentPrintDiscountPercent).toBe(40);
    expect(profile.photoPrintDiscountPercent).toBe(15);
  });

  it('activates education discounts only with verified status and the 199 monthly plan', async () => {
    dbMock.queryOne
      .mockResolvedValueOnce(createUserRow({ account_type: 'personal' }))
      .mockResolvedValueOnce({ has: true })
      .mockResolvedValueOnce({ has: true });

    const profile = await resolveAccountDiscountProfile({ userId: testUserId });

    expect(profile.accountType).toBe('education');
    expect(profile.source).toBe('education_verification');
    expect(profile.documentPrintDiscountPercent).toBe(70);
    expect(dbMock.queryOne.mock.calls[2]?.[1]).toEqual([
      testUserId,
      '79990000000',
      'education',
      'monthly',
      ['education-monthly-199', 'education-yearly-1999', 'education-yearly-199'],
      199,
    ]);
  });

  it('gives verified education access WITHOUT a subscription the no-subscription tier (50/30)', async () => {
    dbMock.queryOne
      .mockResolvedValueOnce(createUserRow({ account_type: 'personal' }))
      .mockResolvedValueOnce({ has: true })   // hasVerifiedEducationAccess → verified
      .mockResolvedValueOnce({ has: false });  // hasActiveAccountDiscountSubscription → no subscription

    const profile = await resolveAccountDiscountProfile({ userId: testUserId });

    expect(profile.accountType).toBe('education');
    expect(profile.source).toBe('education_verified_only');
    expect(profile.documentPrintDiscountPercent).toBe(50);
    expect(profile.photoPrintDiscountPercent).toBe(30);
  });

  it('does not activate an education account without verified education access', async () => {
    dbMock.queryOne
      .mockResolvedValueOnce(createUserRow({ account_type: 'education' }))
      .mockResolvedValueOnce({ has: false });

    const profile = await resolveAccountDiscountProfile({ userId: testUserId });

    expect(profile.source).toBe('none');
    expect(dbMock.queryOne).toHaveBeenCalledTimes(2);
  });
});
