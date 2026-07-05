-- Add status_until for auto-expiration of studio closures
ALTER TABLE studios ADD COLUMN IF NOT EXISTS status_until DATE;

-- Reopen Barrikadnaya (closure was until April 6 inclusive, today is April 7)
UPDATE studios
SET status = 'open', status_message = NULL, status_until = NULL
WHERE location_code = 'barrikadnaya-4';
