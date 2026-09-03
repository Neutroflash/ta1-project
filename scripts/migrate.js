'use strict';

/**
 * Migrador mínimo: aplica los archivos `migrations/*.up.sql` en orden y lleva
 * la cuenta en `schema_migrations`. `down` revierte la última aplicada.
 *
 * El CI ejecuta `up`, luego `down`, luego `up` otra vez: si una migración no es
 * reversible, el pipeline lo descubre antes que producción.
 *
 *   node scripts/migrate.js up|down
 */

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const DIRECTORIO = path.join(__dirname, '..', 'migrations');

/** @param {'up' | 'down'} sentido */
function migracionesDisponibles(sentido) {
  return fs
    .readdirSync(DIRECTORIO)
    .filter((archivo) => archivo.endsWith(`.${sentido}.sql`))
    .sort()
    .map((archivo) => ({ version: archivo.split('.')[0], archivo }));
}

async function main() {
  const sentido = process.argv[2] ?? 'up';
  if (sentido !== 'up' && sentido !== 'down') {
    throw new Error(`Uso: node scripts/migrate.js up|down (recibido: ${sentido})`);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    TEXT PRIMARY KEY,
         aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );

    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const aplicadas = new Set(rows.map((r) => r.version));

    const pendientes =
      sentido === 'up'
        ? migracionesDisponibles('up').filter((m) => !aplicadas.has(m.version))
        : migracionesDisponibles('down')
            .filter((m) => aplicadas.has(m.version))
            .reverse();

    if (pendientes.length === 0) {
      console.log(`Sin migraciones pendientes (${sentido}).`);
      return;
    }

    for (const { version, archivo } of pendientes) {
      const sql = fs.readFileSync(path.join(DIRECTORIO, archivo), 'utf8');
      // Cada migración va en su propia transacción: si falla, no deja la base a medias.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        if (sentido === 'up') {
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        } else {
          await client.query('DELETE FROM schema_migrations WHERE version = $1', [version]);
        }
        await client.query('COMMIT');
        console.log(`${sentido === 'up' ? 'Aplicada' : 'Revertida'}: ${archivo}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Fallo la migración: ${error.message}`);
  process.exit(1);
});
