-- Keep delivery separate from reading: opening a conversation for delivery
-- tracking must not implicitly create a read timestamp.
ALTER TABLE staff_read_receipts
  ALTER COLUMN last_read_at DROP DEFAULT;
