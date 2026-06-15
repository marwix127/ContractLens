-- Guardar el PDF original (para servirlo de vuelta) y marcar contratos de muestra.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS pdf_data BYTEA;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT false;
