'use strict';

/**
 * Lógica de agendamiento de MediTurno.
 *
 * Reglas del negocio que las clínicas nos pidieron respetar:
 *  - Se atiende de 08:00 a 20:00; ningún turno puede empezar ni terminar fuera.
 *  - Los bloques son de 15 minutos y ninguna consulta pasa de 2 horas.
 *  - Dentro de una misma clínica dos turnos no pueden solaparse.
 */

const HORA_APERTURA = 8;
const HORA_CIERRE = 20;
const BLOQUE_MIN = 15;
const DURACION_MAX_MIN = 120;

/** Error de negocio: lleva un código estable que la API traduce a HTTP. */
class ErrorDeAgenda extends Error {
  /**
   * @param {string} codigo
   * @param {string} mensaje
   */
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorDeAgenda';
    this.codigo = codigo;
  }
}

/**
 * @typedef {object} DatosReserva
 * @property {string} [clinicaId]
 * @property {string} [paciente]
 * @property {string | Date} [inicio]
 * @property {number} [duracionMin]
 */

/**
 * Contrato que cumplen tanto la agenda en memoria como la de PostgreSQL. Las
 * operaciones pueden ser síncronas o devolver una promesa; el servidor espera
 * el resultado en ambos casos.
 *
 * @typedef {object} Agenda
 * @property {(datos: DatosReserva) => Turno | Promise<Turno>} reservar
 * @property {(clinicaId: string) => Turno[] | Promise<Turno[]>} listar
 * @property {(id: string | number) => boolean | Promise<boolean>} cancelar
 */

/**
 * @typedef {object} Turno
 * @property {string} id
 * @property {string} clinicaId
 * @property {string} paciente
 * @property {Date} inicio
 * @property {Date} fin
 */

/**
 * @param {Date} inicio
 * @param {number} duracionMin
 * @returns {Date}
 */
function calcularFin(inicio, duracionMin) {
  return new Date(inicio.getTime() + duracionMin * 60_000);
}

/**
 * Dos intervalos se solapan si cada uno empieza antes de que el otro termine.
 *
 * @param {Turno} a
 * @param {{ inicio: Date, fin: Date }} b
 * @returns {boolean}
 */
function seSolapan(a, b) {
  return a.inicio < b.fin && b.inicio < a.fin;
}

/**
 * Valida los datos de una reserva y devuelve el intervalo normalizado.
 *
 * @param {DatosReserva} datos
 * @returns {{ clinicaId: string, paciente: string, inicio: Date, fin: Date }}
 */
function validarReserva(datos) {
  const { clinicaId, paciente, inicio, duracionMin = 30 } = datos;

  if (!clinicaId) {
    throw new ErrorDeAgenda('CLINICA_REQUERIDA', 'Falta el identificador de la clínica.');
  }
  if (!paciente || paciente.trim().length === 0) {
    throw new ErrorDeAgenda('PACIENTE_REQUERIDO', 'El nombre del paciente es obligatorio.');
  }

  const comienzo = inicio instanceof Date ? inicio : new Date(String(inicio));
  if (Number.isNaN(comienzo.getTime())) {
    throw new ErrorDeAgenda('FECHA_INVALIDA', 'La fecha de inicio no es una fecha válida.');
  }

  if (!Number.isInteger(duracionMin) || duracionMin % BLOQUE_MIN !== 0) {
    throw new ErrorDeAgenda(
      'DURACION_INVALIDA',
      `La duración debe ser un múltiplo de ${BLOQUE_MIN} minutos.`
    );
  }
  if (duracionMin < BLOQUE_MIN || duracionMin > DURACION_MAX_MIN) {
    throw new ErrorDeAgenda(
      'DURACION_INVALIDA',
      `La duración debe estar entre ${BLOQUE_MIN} y ${DURACION_MAX_MIN} minutos.`
    );
  }

  const fin = calcularFin(comienzo, duracionMin);
  const empiezaAntesDeAbrir = comienzo.getHours() < HORA_APERTURA;
  const terminaDespuesDeCerrar =
    fin.getHours() > HORA_CIERRE || (fin.getHours() === HORA_CIERRE && fin.getMinutes() > 0);

  if (empiezaAntesDeAbrir || terminaDespuesDeCerrar) {
    throw new ErrorDeAgenda(
      'FUERA_DE_HORARIO',
      `La clínica atiende de ${HORA_APERTURA}:00 a ${HORA_CIERRE}:00.`
    );
  }

  return { clinicaId, paciente: paciente.trim(), inicio: comienzo, fin };
}

/**
 * Agenda en memoria. La versión con PostgreSQL vive en `src/db.js` y respeta
 * este mismo contrato.
 *
 * @returns {Agenda}
 */
function crearAgenda() {
  /** @type {Turno[]} */
  const turnos = [];
  let secuencia = 0;

  return {
    /**
     * @param {DatosReserva} datos
     * @returns {Turno}
     */
    reservar(datos) {
      const reserva = validarReserva(datos);

      const choque = turnos.find((t) => t.clinicaId === reserva.clinicaId && seSolapan(t, reserva));
      if (choque) {
        throw new ErrorDeAgenda(
          'HORARIO_OCUPADO',
          `Ya hay un turno reservado a esa hora (${choque.id}).`
        );
      }

      secuencia += 1;
      /** @type {Turno} */
      const turno = { id: `t-${secuencia}`, ...reserva };
      turnos.push(turno);
      return turno;
    },

    /**
     * @param {string} clinicaId
     * @returns {Turno[]}
     */
    listar(clinicaId) {
      return turnos
        .filter((t) => t.clinicaId === clinicaId)
        .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
    },

    /**
     * @param {string | number} id
     * @returns {boolean} `true` si el turno existía y se canceló.
     */
    cancelar(id) {
      const indice = turnos.findIndex((t) => t.id === id);
      if (indice === -1) {
        return false;
      }
      turnos.splice(indice, 1);
      return true;
    },
  };
}

module.exports = {
  ErrorDeAgenda,
  crearAgenda,
  validarReserva,
  seSolapan,
  HORA_APERTURA,
  HORA_CIERRE,
  BLOQUE_MIN,
  DURACION_MAX_MIN,
};
