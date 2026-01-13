BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'school_settings' AND column_name = 'logo_image'
  ) THEN
    ALTER TABLE school_settings ADD COLUMN logo_image BYTEA;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'school_settings' AND column_name = 'logo_filename'
  ) THEN
    ALTER TABLE school_settings ADD COLUMN logo_filename TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'school_settings' AND column_name = 'logo_format'
  ) THEN
    ALTER TABLE school_settings ADD COLUMN logo_format TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'school_settings' AND column_name = 'logo_width'
  ) THEN
    ALTER TABLE school_settings ADD COLUMN logo_width INT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'school_settings' AND column_name = 'logo_height'
  ) THEN
    ALTER TABLE school_settings ADD COLUMN logo_height INT;
  END IF;
END $$;
COMMIT;
