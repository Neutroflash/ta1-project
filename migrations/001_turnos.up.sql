-- Tabla de turnos. La restricción de exclusión impide en la base de datos lo
-- mismo que `agenda.js` impide en memoria: dos turnos solapados en la misma
-- clínica. Que la regla viva en ambos lados es deliberado: la aplicación da un
-- mensaje claro y la base de datos garantiza la integridad bajo concurrencia.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS turnos (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clinica_id TEXT        NOT NULL,
  paciente   TEXT        NOT NULL,
  inicio     TIMESTAMPTZ NOT NULL,
  fin        TIMESTAMPTZ NOT NULL,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT turno_con_duracion_positiva CHECK (fin > inicio),
  CONSTRAINT turnos_sin_solape EXCLUDE USING gist (
    clinica_id WITH =,
    tstzrange(inicio, fin) WITH &&
  )
);

CREATE INDEX IF NOT EXISTS turnos_clinica_inicio_idx ON turnos (clinica_id, inicio);
