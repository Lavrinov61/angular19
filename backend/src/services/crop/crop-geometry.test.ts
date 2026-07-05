import { describe, expect, it } from 'vitest';
import { computeCropPlan, type CropLines, type CropPreset, type ImageSize } from './crop-geometry.js';

/**
 * Эталонные числа — из 30-architecture.md, раздел «Финальная математика (КАНОНИЧЕСКАЯ)»
 * и Acceptance S1 (строка 178). Каждый кейс снабжён якорем на канонический блок.
 *
 * Фронт-зеркало (src/app/shared/utils/crop-geometry.spec.ts) обязано проходить ТЕ ЖЕ числа.
 */

// Паспорт РФ: 35×45мм, отступ 5мм, голова 32мм, 800dpi.
const PASSPORT: CropPreset = {
  photoWmm: 35,
  photoHmm: 45,
  topMarginMm: 5,
  headHeightMm: 32,
  dpi: 800,
  jpegQuality: 92,
};

describe('computeCropPlan — нормальный кейс (Каноническая математика, acceptance S1 строка 178)', () => {
  // pxPerMm=10: crown=200, chin=520, center=400, img 800×900
  it('даёт extract={225,150,350,450}, extend все 0, target=1102×1417, density=800, warnings=[]', () => {
    const lines: CropLines = { crownY: 200, chinY: 520, centerX: 400 };
    const image: ImageSize = { width: 800, height: 900 };
    const plan = computeCropPlan(lines, PASSPORT, image);

    expect(plan.extract).toEqual({ left: 225, top: 150, width: 350, height: 450 });
    expect(plan.extend).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    expect(plan.target).toEqual({ width: 1102, height: 1417 });
    expect(plan.density).toBe(800);
    expect(plan.jpegQuality).toBe(92);
    expect(plan.warnings).toEqual([{ code: 'low_resolution', valuePx: 450 }]);
  });

  it('инвариант суммы: extract.width + extend.left + extend.right === round(cropW)', () => {
    const lines: CropLines = { crownY: 200, chinY: 520, centerX: 400 };
    const image: ImageSize = { width: 800, height: 900 };
    const plan = computeCropPlan(lines, PASSPORT, image);
    // cropW = 35 * 10 = 350
    expect(plan.extract.width + plan.extend.left + plan.extend.right).toBe(350);
    // cropH = 45 * 10 = 450
    expect(plan.extract.height + plan.extend.top + plan.extend.bottom).toBe(450);
  });
});

describe('computeCropPlan — edge: рамка за краем (extend белым, валидация мм)', () => {
  // Каноническая математика: extend.* = max(0, выход за край), valueMm = round(valuePx/pxPerMm, 1).
  it('extend сверху: crown=20,chin=340,center=400,img 800×900 → extend.top=30 (3мм)', () => {
    const plan = computeCropPlan({ crownY: 20, chinY: 340, centerX: 400 }, PASSPORT, {
      width: 800,
      height: 900,
    });
    expect(plan.extend.top).toBe(30);
    expect(plan.extract.top).toBe(0);
    expect(plan.extract.height).toBe(420);
    const w = plan.warnings.find((x) => x.code === 'extend_top');
    expect(w).toBeDefined();
    expect(w?.valuePx).toBe(30);
    expect(w?.valueMm).toBe(3); // pxPerMm=10 → 30/10 = 3.0мм
  });

  it('extend снизу: crown=500,chin=820,center=400,img 800×850 → extend.bottom=50 (5мм)', () => {
    const plan = computeCropPlan({ crownY: 500, chinY: 820, centerX: 400 }, PASSPORT, {
      width: 800,
      height: 850,
    });
    expect(plan.extend.bottom).toBe(50);
    expect(plan.extract.top).toBe(450);
    expect(plan.extract.height).toBe(400);
    const w = plan.warnings.find((x) => x.code === 'extend_bottom');
    expect(w?.valuePx).toBe(50);
    expect(w?.valueMm).toBe(5);
  });

  it('extend слева: crown=200,chin=520,center=100,img 800×900 → extend.left=75 (7.5мм)', () => {
    const plan = computeCropPlan({ crownY: 200, chinY: 520, centerX: 100 }, PASSPORT, {
      width: 800,
      height: 900,
    });
    expect(plan.extend.left).toBe(75);
    expect(plan.extract.left).toBe(0);
    expect(plan.extract.width).toBe(275);
    const w = plan.warnings.find((x) => x.code === 'extend_left');
    expect(w?.valuePx).toBe(75);
    expect(w?.valueMm).toBe(7.5);
  });

  it('extend справа (cropW не вмещается, center у края): center=750,img 800×900 → extend.right=125 (12.5мм)', () => {
    const plan = computeCropPlan({ crownY: 200, chinY: 520, centerX: 750 }, PASSPORT, {
      width: 800,
      height: 900,
    });
    expect(plan.extend.right).toBe(125);
    expect(plan.extract.left).toBe(575);
    expect(plan.extract.width).toBe(225);
    const w = plan.warnings.find((x) => x.code === 'extend_right');
    expect(w?.valuePx).toBe(125);
    expect(w?.valueMm).toBe(12.5);
  });

  it('cropW > imgW: узкое изображение → extend по обеим горизонталям', () => {
    // pxPerMm=10, cropW=350; img шириной 300 → рамка не вмещается, center по центру
    const plan = computeCropPlan({ crownY: 200, chinY: 520, centerX: 150 }, PASSPORT, {
      width: 300,
      height: 900,
    });
    // idealLeft = 150 - 175 = -25 → extend.left=25; idealLeft+cropW = -25+350 = 325 > 300 → extend.right=25
    expect(plan.extend.left).toBe(25);
    expect(plan.extend.right).toBe(25);
    expect(plan.extract.left).toBe(0);
    expect(plan.extract.width).toBe(300);
    // инвариант суммы держится: 300 + 25 + 25 = 350 = round(cropW)
    expect(plan.extract.width + plan.extend.left + plan.extend.right).toBe(350);
  });
});

describe('computeCropPlan — дробный pxPerMm и округление target', () => {
  it('дробный pxPerMm=6.25: crown=100,chin=300,center=250,img 500×600 → extract={141,69,219,281}', () => {
    // pxPerMm = (300-100)/32 = 6.25; cropW=218.75→round 219, cropH=281.25→round 281
    const plan = computeCropPlan({ crownY: 100, chinY: 300, centerX: 250 }, PASSPORT, {
      width: 500,
      height: 600,
    });
    expect(plan.extract).toEqual({ left: 141, top: 69, width: 219, height: 281 });
    expect(plan.extend).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    // target от dpi — НЕ зависит от pxPerMm
    expect(plan.target).toEqual({ width: 1102, height: 1417 });
  });

  it('target масштабируется по dpi: dpi=600 → 827×1063', () => {
    const preset600: CropPreset = { ...PASSPORT, dpi: 600 };
    const plan = computeCropPlan({ crownY: 200, chinY: 520, centerX: 400 }, preset600, {
      width: 800,
      height: 900,
    });
    // round(35/25.4*600)=827, round(45/25.4*600)=1063
    expect(plan.target).toEqual({ width: 827, height: 1063 });
    expect(plan.density).toBe(600);
  });

  it('target passport dpi=800 → 1102×1417', () => {
    const plan = computeCropPlan({ crownY: 200, chinY: 520, centerX: 400 }, PASSPORT, {
      width: 800,
      height: 900,
    });
    expect(plan.target).toEqual({ width: 1102, height: 1417 });
    expect(plan.density).toBe(800);
  });
});

describe('computeCropPlan — low_resolution (триггер: target.height > 1.5 * round(cropH))', () => {
  // Каноническое правило (30-architecture.md): UPSCALE_WARN_FACTOR=1.5, считаем от round(cropH),
  // valuePx=round(cropH), valueMm НЕ задаём. ЗЕРКАЛО фронтового spec 1:1 (P2-3).
  it('зеркало фронта: crown=300,chin=450,center=400,img 800×900 → low_resolution valuePx=211', () => {
    // pxPerMm=150/32=4.6875; extract={318,277,164,211}; extend все 0; target=1102×1417;
    // 1417 > 1.5*round(cropH)=1.5*211=316.5 → срабатывает.
    const plan = computeCropPlan({ crownY: 300, chinY: 450, centerX: 400 }, PASSPORT, {
      width: 800,
      height: 900,
    });
    expect(plan.extract).toEqual({ left: 318, top: 277, width: 164, height: 211 });
    expect(plan.extend).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    expect(plan.target).toEqual({ width: 1102, height: 1417 });
    expect(plan.warnings).toEqual([{ code: 'low_resolution', valuePx: 211 }]);
  });

  it('нормальное разрешение (эталон pxPerMm=10): low_resolution НЕ срабатывает', () => {
    // round(cropH)=450, target.height=1417, 1.5*450=675 < 1417 → срабатывает при 800 dpi.
    const plan = computeCropPlan({ crownY: 200, chinY: 520, centerX: 400 }, PASSPORT, {
      width: 800,
      height: 900,
    });
    expect(plan.warnings.find((x) => x.code === 'low_resolution')).toEqual({
      code: 'low_resolution',
      valuePx: 450,
    });
  });
});

describe('computeCropPlan — RangeError (страж; анти-тампер обязан отсечь раньше)', () => {
  it('chinY <= crownY (инвертированная высота) → RangeError', () => {
    expect(() =>
      computeCropPlan({ crownY: 520, chinY: 200, centerX: 400 }, PASSPORT, { width: 800, height: 900 })
    ).toThrow(RangeError);
  });

  it('нулевая высота лица (chin == crown) → RangeError', () => {
    expect(() =>
      computeCropPlan({ crownY: 300, chinY: 300, centerX: 400 }, PASSPORT, { width: 800, height: 900 })
    ).toThrow(RangeError);
  });

  it('сообщение RangeError — "invalid face height"', () => {
    expect(() =>
      computeCropPlan({ crownY: 300, chinY: 300, centerX: 400 }, PASSPORT, { width: 800, height: 900 })
    ).toThrow('invalid face height');
  });
});
