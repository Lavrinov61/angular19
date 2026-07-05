-- Migration 048: Fix combo_packages original_total to match actual item sums
-- Also fix business-portfolio combo_price (was higher than item sum)

-- doc-standard: original_total was 1590, real sum = 700+700 = 1400
UPDATE combo_packages SET original_total = 1400.00, savings_label = 'Экономия 110₽'
WHERE slug = 'doc-standard';

-- doc-vip: original_total was 2170, real sum = 700+700+290+290 = 1980
UPDATE combo_packages SET original_total = 1980.00, savings_label = 'Экономия 190₽'
WHERE slug = 'doc-vip';

-- business-portfolio: combo_price 1490 > real sum 1117 (was a markup, not a discount!)
-- Fix: set combo_price to 950 (real discount), original_total to actual sum
UPDATE combo_packages SET original_total = 1117.00, combo_price = 950.00, savings_label = 'Экономия 167₽'
WHERE slug = 'business-portfolio';

-- family-memory: original_total was 3700, real sum = 900+100+2200 = 3200
UPDATE combo_packages SET original_total = 3200.00, savings_label = 'Экономия 10₽'
WHERE slug = 'family-memory';
