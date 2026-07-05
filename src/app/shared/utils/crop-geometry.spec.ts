import { computeCropPlan } from './crop-geometry';
import type { CropImageSize, CropLines, DocumentCropPreset } from '../../core/models/ai-retouch.models';

/**
 * ЗЕРКАЛО бэк-теста `backend/src/services/crop/crop-geometry.test.ts` (P2-3).
 * Те же табличные числа, что у бэка → дрейф фронт↔бэк ловится сразу.
 * Источник чисел — «Финальная математика (КАНОНИЧЕСКАЯ)» 30-architecture.md
 * и acceptance S1/S3 (строки 178, 180).
 */

// Паспорт РФ: 35×45, отступ сверху 5мм, голова 32мм, 800 dpi, jpeg 92.
const PASSPORT: DocumentCropPreset = {
  photoWmm: 35,
  photoHmm: 45,
  topMarginMm: 5,
  headHeightMm: 32,
  dpi: 800,
  jpegQuality: 92,
};

describe('computeCropPlan', () => {
  it('норма (паспорт, pxPerMm=10) → extract={225,150,350,450}, target=1102×1417', () => {
    // crown=200, chin=520 → pxPerMm=(520-200)/32=10; center=400; img 800×900.
    const lines: CropLines = { crownY: 200, chinY: 520, centerX: 400 };
    const image: CropImageSize = { width: 800, height: 900 };

    const plan = computeCropPlan(lines, PASSPORT, image);

    expect(plan.extract).toEqual({ left: 225, top: 150, width: 350, height: 450 });
    expect(plan.extend).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    expect(plan.target).toEqual({ width: 1102, height: 1417 });
    expect(plan.density).toBe(800);
    expect(plan.jpegQuality).toBe(92);
    expect(plan.warnings).toEqual([{ code: 'low_resolution', valuePx: 450 }]);
  });

  it('edge: мало поля над макушкой → extend_top, итог высота extract урезана', () => {
    // crown=30, chin=350 → pxPerMm=10; idealTop=30-50=-20 → extend.top=20.
    const lines: CropLines = { crownY: 30, chinY: 350, centerX: 400 };
    const image: CropImageSize = { width: 800, height: 900 };

    const plan = computeCropPlan(lines, PASSPORT, image);

    expect(plan.extend.top).toBe(20);
    expect(plan.extract.top).toBe(0);
    // valueMm = 20px / 10 pxPerMm = 2.0 мм
    const w = plan.warnings.find((x) => x.code === 'extend_top');
    expect(w).toBeDefined();
    expect(w!.valuePx).toBe(20);
    expect(w!.valueMm).toBe(2);
  });

  it('edge: центр у нижнего края → extend_bottom', () => {
    // crown=200, chin=520 → pxPerMm=10; cropH=450; idealTop=150; 150+450=600 > height=500 → extend.bottom=100.
    const lines: CropLines = { crownY: 200, chinY: 520, centerX: 400 };
    const image: CropImageSize = { width: 800, height: 500 };

    const plan = computeCropPlan(lines, PASSPORT, image);

    expect(plan.extend.bottom).toBe(100);
    const w = plan.warnings.find((x) => x.code === 'extend_bottom');
    expect(w).toBeDefined();
    expect(w!.valuePx).toBe(100);
    expect(w!.valueMm).toBe(10);
  });

  it('edge: центр у левого края → extend_left', () => {
    // center=100, cropW=350 → idealLeft=100-175=-75 → extend.left=75.
    const lines: CropLines = { crownY: 200, chinY: 520, centerX: 100 };
    const image: CropImageSize = { width: 800, height: 900 };

    const plan = computeCropPlan(lines, PASSPORT, image);

    expect(plan.extend.left).toBe(75);
    expect(plan.extract.left).toBe(0);
    const w = plan.warnings.find((x) => x.code === 'extend_left');
    expect(w).toBeDefined();
    expect(w!.valueMm).toBe(7.5);
  });

  it('edge: центр у правого края → extend_right', () => {
    // center=750, cropW=350 → idealLeft=575; 575+350=925 > width=800 → extend.right=125.
    const lines: CropLines = { crownY: 200, chinY: 520, centerX: 750 };
    const image: CropImageSize = { width: 800, height: 900 };

    const plan = computeCropPlan(lines, PASSPORT, image);

    expect(plan.extend.right).toBe(125);
    const w = plan.warnings.find((x) => x.code === 'extend_right');
    expect(w).toBeDefined();
    expect(w!.valueMm).toBe(12.5);
  });

  it('cropW > imgW → extend слева И справа (узкое изображение)', () => {
    // center=200, cropW=350; img width=300. idealLeft=200-175=25; extend.left=0.
    // 25+350=375 > 300 → extend.right=75. extract.width = round(350)-0-75=275, clamp(275,1,300-25=275)=275.
    const lines: CropLines = { crownY: 200, chinY: 520, centerX: 200 };
    const image: CropImageSize = { width: 300, height: 900 };

    const plan = computeCropPlan(lines, PASSPORT, image);

    expect(plan.extend.right).toBe(75);
    expect(plan.extract.width).toBe(275);
  });

  it('инвариант суммы: extract.width + extend.left + extend.right === round(cropW)', () => {
    // edge с extend слева: center=100 → extend.left=75, extract.left=0.
    const lines: CropLines = { crownY: 200, chinY: 520, centerX: 100 };
    const image: CropImageSize = { width: 800, height: 900 };

    const plan = computeCropPlan(lines, PASSPORT, image);

    const cropW = 350; // 35мм * pxPerMm(10)
    expect(plan.extract.width + plan.extend.left + plan.extend.right).toBe(cropW);
    const cropH = 450; // 45мм * pxPerMm(10)
    expect(plan.extract.height + plan.extend.top + plan.extend.bottom).toBe(cropH);
  });

  it('дробный pxPerMm: округление extract/extend без потери инварианта', () => {
    // chin-crown=100, head=32 → pxPerMm=3.125; cropW=109.375→round 109; cropH=140.625→round 141.
    const lines: CropLines = { crownY: 100, chinY: 200, centerX: 60 };
    const image: CropImageSize = { width: 200, height: 400 };

    const plan = computeCropPlan(lines, PASSPORT, image);

    // idealLeft = 60 - 109.375/2 = 60 - 54.6875 = 5.3125 → extract.left=round=5, extend.left=0.
    expect(plan.extend.left).toBe(0);
    expect(plan.extract.left).toBe(5);
    // инвариант ширины держится при дробном масштабе.
    expect(plan.extract.width + plan.extend.left + plan.extend.right).toBe(Math.round(35 * 3.125));
  });

  it('low_resolution: мелкий источник (pxPerMm≈4.69), рамка ВНУТРИ кадра → target.height > 1.5*round(cropH)', () => {
    // chin-crown=150, head=32 → pxPerMm=4.6875; cropH=210.9375→round 211; target.height=531.
    // 531 > 1.5*211=316.5 → срабатывает. valuePx=round(cropH)=211.
    const lines: CropLines = { crownY: 300, chinY: 450, centerX: 400 };
    const image: CropImageSize = { width: 800, height: 900 };

    const plan = computeCropPlan(lines, PASSPORT, image);

    // extend пустые — рамка целиком в кадре, low_resolution про РАЗРЕШЕНИЕ, а не обрезку.
    expect(plan.extend).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    const w = plan.warnings.find((x) => x.code === 'low_resolution');
    expect(w).toBeDefined();
    expect(w!.valuePx).toBe(211);
    // valueMm НЕ задаётся для low_resolution — форма идентична бэку.
    expect(w!.valueMm).toBeUndefined();
  });

  it('эталон pxPerMm=10 при 800 dpi → low_resolution', () => {
    const lines: CropLines = { crownY: 200, chinY: 520, centerX: 400 };
    const image: CropImageSize = { width: 800, height: 900 };

    const plan = computeCropPlan(lines, PASSPORT, image);

    expect(plan.warnings.find((w) => w.code === 'low_resolution')).toEqual({
      code: 'low_resolution',
      valuePx: 450,
    });
  });

  it('округление target при dpi=600 → 827×1063', () => {
    const preset: DocumentCropPreset = { ...PASSPORT, dpi: 600 };
    const lines: CropLines = { crownY: 200, chinY: 520, centerX: 400 };
    const image: CropImageSize = { width: 1600, height: 1800 };

    const plan = computeCropPlan(lines, preset, image);

    // 35/25.4*600=826.77→827; 45/25.4*600=1062.99→1063.
    expect(plan.target).toEqual({ width: 827, height: 1063 });
    expect(plan.density).toBe(600);
  });

  it('RangeError при подбородке выше/равном макушке (chin <= crown)', () => {
    const image: CropImageSize = { width: 800, height: 900 };
    expect(() => computeCropPlan({ crownY: 500, chinY: 300, centerX: 400 }, PASSPORT, image)).toThrow(RangeError);
    expect(() => computeCropPlan({ crownY: 400, chinY: 400, centerX: 400 }, PASSPORT, image)).toThrow(RangeError);
  });

  it('RangeError при нулевой высоте лица (pxPerMm не finite/<=0)', () => {
    const image: CropImageSize = { width: 800, height: 900 };
    expect(() => computeCropPlan({ crownY: NaN, chinY: 500, centerX: 400 }, PASSPORT, image)).toThrow(RangeError);
  });
});
