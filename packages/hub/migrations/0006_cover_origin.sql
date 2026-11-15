-- Where each cover came from: GSM's game image, a YouTube thumbnail, or one the user chose.
-- A cover the user chose is never replaced or removed by a sync.
ALTER TABLE covers ADD COLUMN origin TEXT NOT NULL DEFAULT 'gsm';  -- 'gsm' | 'youtube' | 'manual'
UPDATE covers SET origin = 'youtube' WHERE content_id LIKE 'yt:%';
