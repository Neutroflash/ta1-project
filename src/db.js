'use strict';

const { Pool } = require('pg');
const { validarReserva, ErrorDeAgenda } = require('./agenda');

/**
 * Agenda respaldada por PostgreSQL. Expone el mismo contrato que
 * `crearAgenda()` para que el servidor no sepa dónde viven los datos.
 *
 * @param {{ connectionString?: string, pool?: import('pg').Pool }} [opciones]
 * @returns {import('./agenda').Agenda & { cerrar: () => Promise<void> }}
 */
function crearAgendaPg(opciones = {}) {
  const pool =
    opciones.pool ??
    new Pool({ connectionString: opciones.connectionString ?? process.env.DATABASE_URL });

  return {
    /** @param {import('./agenda').DatosReserva} datos */
    async reservar(datos) {
      const reserva = validarReserva(datos);

      // La restricción de exclusión de la tabla es la que decide: dejamos que
      // PostgreSQL resuelva la carrera entre dos recepcionistas simultáneas.
      try {
        const { rows } = await pool.query(
          `INSERT INTO turnos (clinica_id, paciente, inicio, fin)
           VALUES ($1, $2, $3, $4)
           RETURNING id, clinica_id AS "clinicaId", paciente, inicio, fin`,
          [reserva.clinicaId, reserva.paciente, reserva.inicio, reserva.fin]
        );
        return rows[0];
      } catch (error) {
        if (error && error.code === '23P01') {
          throw new ErrorDeAgenda('HORARIO_OCUPADO', 'Ya hay un turno reservado a esa hora.');
        }
        throw error;
      }
    },

    /** @param {string} clinicaId */
    async listar(clinicaId) {
      const { rows } = await pool.query(
        `SELECT id, clinica_id AS "clinicaId", paciente, inicio, fin
           FROM turnos
          WHERE clinica_id = $1
          ORDER BY inicio`,
        [clinicaId]
      );
      return rows;
    },

    /** @param {string | number} id */
    async cancelar(id) {
      const { rowCount } = await pool.query('DELETE FROM turnos WHERE id = $1', [id]);
      return rowCount > 0;
    },

    async cerrar() {
      await pool.end();
    },
  };
}

module.exports = { crearAgendaPg };
