'use strict';

const { crearServidor } = require('../../src/servidor');
const { crearAgenda } = require('../../src/agenda');

/** @type {import('node:http').Server} */
let servidor;
/** @type {string} */
let base;

/**
 * @param {object} [opciones]
 * @returns {Promise<void>}
 */
function levantar(opciones) {
  servidor = crearServidor(opciones);
  return new Promise((resolve) => {
    servidor.listen(0, () => {
      base = `http://127.0.0.1:${servidor.address().port}`;
      resolve();
    });
  });
}

/**
 * @param {string} ruta
 * @param {object} cuerpo
 * @returns {Promise<Response>}
 */
function postear(ruta, cuerpo) {
  return fetch(`${base}${ruta}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  });
}

const RESERVA = {
  clinicaId: 'clinica-1',
  paciente: 'Ana Rojas',
  inicio: '2026-09-08T09:00:00',
  duracionMin: 30,
};

afterEach(
  () =>
    new Promise((resolve) => {
      // `fetch` mantiene el socket abierto (keep-alive) y el sistema puede
      // reasignar el puerto efímero al servidor de la prueba siguiente, así que
      // cortamos las conexiones antes de cerrar en vez de dejarlas al azar.
      servidor.closeAllConnections();
      servidor.close(() => resolve());
    })
);

describe('API de turnos', () => {
  test('GET /health responde ok', async () => {
    await levantar();
    const res = await fetch(`${base}/health`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ estado: 'ok', version: 'dev' });
  });

  test('POST /api/turnos crea el turno', async () => {
    await levantar();
    const res = await postear('/api/turnos', RESERVA);

    expect(res.status).toBe(201);
    expect((await res.json()).turno.paciente).toBe('Ana Rojas');
  });

  test('POST /api/turnos devuelve 409 si el horario ya está tomado', async () => {
    await levantar();
    await postear('/api/turnos', RESERVA);
    const res = await postear('/api/turnos', RESERVA);

    expect(res.status).toBe(409);
    expect((await res.json()).codigo).toBe('HORARIO_OCUPADO');
  });

  test('POST /api/turnos devuelve 400 con datos inválidos', async () => {
    await levantar();
    const res = await postear('/api/turnos', { ...RESERVA, paciente: '' });

    expect(res.status).toBe(400);
    expect((await res.json()).codigo).toBe('PACIENTE_REQUERIDO');
  });

  test('POST /api/turnos devuelve 400 si el JSON está mal formado', async () => {
    await levantar();
    const res = await postear('/api/turnos', '{ esto no es json');

    expect(res.status).toBe(400);
    expect((await res.json()).codigo).toBe('JSON_INVALIDO');
  });

  test('GET /api/turnos exige la clínica y luego lista', async () => {
    await levantar();
    expect((await fetch(`${base}/api/turnos`)).status).toBe(400);

    await postear('/api/turnos', RESERVA);
    const res = await fetch(`${base}/api/turnos?clinicaId=clinica-1`);

    expect(res.status).toBe(200);
    expect((await res.json()).turnos).toHaveLength(1);
  });

  test('una ruta desconocida responde 404', async () => {
    await levantar();
    expect((await fetch(`${base}/no-existe`)).status).toBe(404);
  });

  test('un fallo inesperado responde 500 sin filtrar el detalle', async () => {
    const agenda = crearAgenda();
    agenda.listar = () => {
      throw new Error('la base de datos se cayó');
    };
    await levantar({ agenda });

    const res = await fetch(`${base}/api/turnos?clinicaId=clinica-1`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ codigo: 'ERROR_INTERNO' });
  });
});
