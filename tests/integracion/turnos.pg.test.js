'use strict';

/**
 * Pruebas contra un PostgreSQL real (el `service container` del CI).
 * Verifican lo que las pruebas unitarias no pueden: que el esquema, la
 * restricción de exclusión y el mapeo de columnas funcionen de verdad.
 */

const { Pool } = require('pg');
const { crearAgendaPg } = require('../../src/db');

/** @type {import('pg').Pool} */
let pool;
/** @type {ReturnType<typeof crearAgendaPg>} */
let agenda;

const RESERVA = {
  clinicaId: 'clinica-1',
  paciente: 'Ana Rojas',
  inicio: '2026-09-08T09:00:00',
  duracionMin: 30,
};

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  agenda = crearAgendaPg({ pool });
});

afterAll(() => pool.end());

beforeEach(() => pool.query('TRUNCATE turnos'));

test('la migración dejó la tabla turnos disponible', async () => {
  const { rows } = await pool.query("SELECT to_regclass('public.turnos') IS NOT NULL AS existe");
  expect(rows[0].existe).toBe(true);
});

test('guarda y recupera un turno', async () => {
  const creado = await agenda.reservar(RESERVA);
  expect(creado.paciente).toBe('Ana Rojas');

  const turnos = await agenda.listar('clinica-1');
  expect(turnos).toHaveLength(1);
  expect(turnos[0].id).toBe(creado.id);
});

test('la base de datos rechaza el solape aunque la validación se saltara', async () => {
  await agenda.reservar(RESERVA);
  await expect(agenda.reservar({ ...RESERVA, inicio: '2026-09-08T09:15:00' })).rejects.toThrow(
    /Ya hay un turno reservado/
  );
});

test('acepta el mismo horario en otra clínica', async () => {
  await agenda.reservar(RESERVA);
  await expect(agenda.reservar({ ...RESERVA, clinicaId: 'clinica-2' })).resolves.toBeDefined();
});

test('cancelar elimina el turno e informa si no existía', async () => {
  const creado = await agenda.reservar(RESERVA);
  expect(await agenda.cancelar(creado.id)).toBe(true);
  expect(await agenda.listar('clinica-1')).toHaveLength(0);
  expect(await agenda.cancelar(999_999)).toBe(false);
});
