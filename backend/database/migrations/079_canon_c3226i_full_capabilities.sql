-- Migration 079: Canon C3226i full PrintCapabilities from driver XML
-- Date: 2026-04-05
-- Idempotent: jsonb || merges, preserving existing keys

UPDATE printers
SET capabilities = capabilities || jsonb_build_object(
  'supported_nup', ARRAY[1, 2, 4, 6, 9, 16],
  'supported_staple', ARRAY['none', 'top_left', 'top_right', 'bottom_left', 'bottom_right', 'dual_left', 'dual_right', 'dual_top', 'dual_bottom', 'saddle_stitch'],
  'supported_stapleless', ARRAY['none', 'top_left', 'top_right', 'bottom_left', 'bottom_right'],
  'supported_hole_punch', ARRAY['none', 'left', 'right', 'top', 'bottom'],
  'supported_hole_punch_types', ARRAY['none', '2_hole', '3_hole', '4_hole'],
  'supported_binding', ARRAY['none', 'booklet'],
  'supported_resolutions', ARRAY[600, 1200],
  'supports_collate', true,
  'supports_color_auto_detect', true,
  'paper_sizes', ARRAY['a0','a1','a2','a3','a4','a5','a6','b1','b2','b3','b4','b5','letter','legal','tabloid','executive','statement','sra3','dl_envelope','c5_envelope','monarch_envelope','no10_envelope','postcard','oficio','foolscap','c16k','c8k','custom'],
  'media_types_extended', ARRAY['auto','plain','plain2','plain3','thin','thin2','recycled','recycled2','recycled3','color','pre_punched','pre_punched2','letterhead','bond','pasteboard','transparency','transparency_film','label','tracing_paper','postcard','envelope','one_side_coated','two_side_coated']
)
WHERE name = 'Canon C3226i'
   OR cups_printer_name = 'iR C3226';
