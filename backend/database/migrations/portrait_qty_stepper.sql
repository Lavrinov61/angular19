-- Portrait qty stepper: allow ordering multiple portraits.
-- Changes portrait-processing group from single-select (exactly 1)
-- to quantity-select (1..20) so the qty stepper appears in CRM order form.
-- Idempotent: WHERE selection_type = 'single' prevents re-run changes.

UPDATE option_groups
SET selection_type = 'quantity',
    min_selections = 1,
    max_selections = 20
WHERE slug = 'portrait-processing'
  AND service_category_id = (SELECT id FROM service_categories WHERE slug = 'portrait')
  AND selection_type = 'single';
