-- Sustituye el índice IVFFlat histórico por HNSW.
-- HNSW no necesita una fase de entrenamiento y ofrece mejor recall para el
-- volumen pequeño e incremental de ContractLens.
BEGIN;

DROP INDEX IF EXISTS chunks_embedding_idx;

CREATE INDEX chunks_embedding_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

COMMIT;
