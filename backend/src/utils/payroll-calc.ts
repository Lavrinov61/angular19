/**
 * Payroll calculations: progressive NDFL (2026), employer contributions, pension points.
 * RF tax legislation 2026: Federal Law No. 176-FZ (progressive NDFL scale).
 */

import type { NdflBracket, NdflDetails, EmployerContributions, PensionPoints } from '../types/views/earnings-views.js';

// ─── НДФЛ 2026: прогрессивная шкала ─────────────────────────────────────────
const NDFL_BRACKETS: readonly NdflBracket[] = [
  { threshold: 2_400_000, rate: 0.13 },
  { threshold: 5_000_000, rate: 0.15 },
  { threshold: 20_000_000, rate: 0.18 },
  { threshold: 50_000_000, rate: 0.20 },
  { threshold: Infinity, rate: 0.22 },
] as const;

// ─── Страховые взносы 2026 ──────────────────────────────────────────────────
const CONTRIBUTION_RATES = {
  pension: 0.22,
  medical: 0.051,
  social: 0.029,
  injury: 0.002,
} as const;

const CONTRIBUTION_BASE_LIMIT = 2_979_000;

// ─── Пенсионные баллы 2026 ──────────────────────────────────────────────────
const PENSION_POINT_VALUE_2026 = 156.76;
const PENSION_FIXED_PAYMENT_2026 = 9_584.69;
const MAX_PENSION_POINTS_PER_YEAR = 10;

/**
 * Рассчитать НДФЛ за месяц по прогрессивной шкале.
 * @param ytdBefore — совокупный доход с начала года ДО этого месяца
 * @param monthlyIncome — доход за текущий месяц (gross)
 */
export function calculateNdfl(ytdBefore: number, monthlyIncome: number): NdflDetails {
  if (monthlyIncome <= 0) {
    return {
      ytd_income_before: ytdBefore,
      ytd_income_after: ytdBefore,
      effective_rate: 0,
      ndfl_amount: 0,
      brackets_applied: [],
    };
  }

  const ytdAfter = ytdBefore + monthlyIncome;

  // НДФЛ на весь YTD доход включая этот месяц
  const totalTaxYtd = computeProgressiveTax(ytdAfter);
  // НДФЛ на YTD доход БЕЗ этого месяца
  const totalTaxBefore = computeProgressiveTax(ytdBefore);
  // Разница = налог именно за этот месяц
  const ndflAmount = Math.round(totalTaxYtd - totalTaxBefore);

  const bracketsApplied = computeBracketsBreakdown(ytdBefore, monthlyIncome);

  const effectiveRate = monthlyIncome > 0 ? ndflAmount / monthlyIncome : 0;

  return {
    ytd_income_before: ytdBefore,
    ytd_income_after: ytdAfter,
    effective_rate: Math.round(effectiveRate * 10000) / 10000,
    ndfl_amount: ndflAmount,
    brackets_applied: bracketsApplied,
  };
}

function computeProgressiveTax(income: number): number {
  if (income <= 0) return 0;
  let remaining = income;
  let prevThreshold = 0;
  let tax = 0;

  for (const bracket of NDFL_BRACKETS) {
    const bracketWidth = bracket.threshold - prevThreshold;
    const taxableInBracket = Math.min(remaining, bracketWidth);
    tax += taxableInBracket * bracket.rate;
    remaining -= taxableInBracket;
    prevThreshold = bracket.threshold;
    if (remaining <= 0) break;
  }

  return tax;
}

function computeBracketsBreakdown(
  ytdBefore: number,
  monthlyIncome: number,
): { bracket_rate: number; taxable_in_bracket: number; tax: number }[] {
  const result: { bracket_rate: number; taxable_in_bracket: number; tax: number }[] = [];
  let remaining = monthlyIncome;
  let prevThreshold = 0;

  for (const bracket of NDFL_BRACKETS) {
    if (remaining <= 0) break;

    const bracketStart = prevThreshold;
    const bracketEnd = bracket.threshold;
    prevThreshold = bracket.threshold;

    // Определяем какая часть дохода за месяц попадает в эту скобку
    if (ytdBefore >= bracketEnd) continue; // весь YTD before уже за пределами этой скобки

    const effectiveStart = Math.max(ytdBefore, bracketStart);
    const spaceInBracket = bracketEnd - effectiveStart;
    const taxableInBracket = Math.min(remaining, spaceInBracket);

    if (taxableInBracket > 0) {
      const tax = Math.round(taxableInBracket * bracket.rate);
      result.push({
        bracket_rate: bracket.rate,
        taxable_in_bracket: taxableInBracket,
        tax,
      });
      remaining -= taxableInBracket;
    }
  }

  return result;
}

/**
 * Рассчитать страховые взносы работодателя за месяц.
 * @param grossMonthly — gross зарплата за месяц
 */
export function calculateEmployerContributions(grossMonthly: number): EmployerContributions {
  // Упрощённый расчёт — взносы от gross без учёта предельной базы в помесячном контексте.
  // Для точного расчёта нужна YTD база — добавим позже при необходимости.
  const pension = Math.round(grossMonthly * CONTRIBUTION_RATES.pension);
  const medical = Math.round(grossMonthly * CONTRIBUTION_RATES.medical);
  const social = Math.round(grossMonthly * CONTRIBUTION_RATES.social);
  const injury = Math.round(grossMonthly * CONTRIBUTION_RATES.injury);

  return {
    pension,
    medical,
    social,
    injury,
    total: pension + medical + social + injury,
  };
}

/**
 * Рассчитать пенсионные баллы.
 * @param ytdGrossIncome — совокупный gross доход с начала года (включая текущий месяц)
 * @param monthlyGrossIncome — gross доход за текущий месяц
 */
export function calculatePensionPoints(ytdGrossIncome: number, monthlyGrossIncome: number): PensionPoints {
  // Годовые баллы: (Годовой доход / Предельная база) * 10, max 10
  const ytdPoints = Math.min(
    (ytdGrossIncome / CONTRIBUTION_BASE_LIMIT) * MAX_PENSION_POINTS_PER_YEAR,
    MAX_PENSION_POINTS_PER_YEAR,
  );

  // Баллы за месяц (приблизительно)
  const monthlyPoints = Math.min(
    (monthlyGrossIncome / CONTRIBUTION_BASE_LIMIT) * MAX_PENSION_POINTS_PER_YEAR,
    MAX_PENSION_POINTS_PER_YEAR,
  );

  // Сколько даёт один балл к ежемесячной пенсии
  const estimatedMonthlyPensionIncrement = Math.round(monthlyPoints * PENSION_POINT_VALUE_2026 * 100) / 100;

  return {
    monthly: Math.round(monthlyPoints * 10000) / 10000,
    ytd: Math.round(ytdPoints * 10000) / 10000,
    point_value_rub: PENSION_POINT_VALUE_2026,
    estimated_monthly_pension_increment: estimatedMonthlyPensionIncrement,
  };
}

export { CONTRIBUTION_BASE_LIMIT, PENSION_FIXED_PAYMENT_2026 };
