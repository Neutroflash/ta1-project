'use strict';

const { crearAgenda, ErrorDeAgenda } = require('../../src/agenda');

/** Un martes cualquiera, en horario de atención. */
const MARTES_9 = new Date('2026-09-08T09:00:00');

/**
 * @param {object} extra
 * @returns {object}
 */
function reservaValida(extra = {}) {
  return {
    clinicaId: 'clinica-1',
    paciente: 'Ana Rojas',
    inicio: MARTES_9,
    duracionMin: 30,
    ...extra,
  };
}

describe('crearAgenda', () => {
  test('reserva un turno y calcula la hora de término', () => {
    const agenda = crearAgenda();
    const turno = agenda.reservar(reservaValida());

    expect(turno.id).toBe('t-1');
    expect(turno.paciente).toBe('Ana Rojas');
    expect(turno.fin.toISOString()).toBe(new Date('2026-09-08T09:30:00').toISOString());
  });

  test('recorta los espacios del nombre del paciente', () => {
    const agenda = crearAgenda();
    expect(agenda.reservar(reservaValida({ paciente: '  Luis Paredes  ' })).paciente).toBe(
      'Luis Paredes'
    );
  });

  test('acepta la fecha como texto ISO', () => {
    const agenda = crearAgenda();
    expect(agenda.reservar(reservaValida({ inicio: '2026-09-08T10:00:00' })).id).toBe('t-1');
  });

  test('usa 30 minutos cuando no se indica duración', () => {
    const agenda = crearAgenda();
    const { inicio, fin } = agenda.reservar({
      clinicaId: 'clinica-1',
      paciente: 'Ana Rojas',
      inicio: MARTES_9,
    });
    expect((fin - inicio) / 60_000).toBe(30);
  });

  describe('rechaza datos inválidos', () => {
    const casos = [
      ['CLINICA_REQUERIDA', { clinicaId: undefined }],
      ['PACIENTE_REQUERIDO', { paciente: '   ' }],
      ['FECHA_INVALIDA', { inicio: 'el martes' }],
      ['DURACION_INVALIDA', { duracionMin: 20 }],
      ['DURACION_INVALIDA', { duracionMin: 135 }],
      ['DURACION_INVALIDA', { duracionMin: 0 }],
      ['FUERA_DE_HORARIO', { inicio: new Date('2026-09-08T07:30:00') }],
      ['FUERA_DE_HORARIO', { inicio: new Date('2026-09-08T19:45:00') }],
    ];

    test.each(casos)('lanza %s', (codigo, cambio) => {
      const agenda = crearAgenda();
      expect(() => agenda.reservar(reservaValida(cambio))).toThrow(ErrorDeAgenda);
      try {
        agenda.reservar(reservaValida(cambio));
      } catch (error) {
        expect(error.codigo).toBe(codigo);
      }
    });
  });

  test('permite un turno que termina justo a la hora de cierre', () => {
    const agenda = crearAgenda();
    expect(agenda.reservar(reservaValida({ inicio: new Date('2026-09-08T19:30:00') })).id).toBe(
      't-1'
    );
  });

  test('rechaza un turno que se solapa con otro de la misma clínica', () => {
    const agenda = crearAgenda();
    agenda.reservar(reservaValida());

    expect(() =>
      agenda.reservar(reservaValida({ inicio: new Date('2026-09-08T09:15:00') }))
    ).toThrow(/Ya hay un turno reservado/);
  });

  test('permite la misma hora en clínicas distintas', () => {
    const agenda = crearAgenda();
    agenda.reservar(reservaValida());
    expect(agenda.reservar(reservaValida({ clinicaId: 'clinica-2' })).id).toBe('t-2');
  });

  test('permite turnos consecutivos que se tocan sin solaparse', () => {
    const agenda = crearAgenda();
    agenda.reservar(reservaValida());
    expect(agenda.reservar(reservaValida({ inicio: new Date('2026-09-08T09:30:00') })).id).toBe(
      't-2'
    );
  });

  test('lista solo los turnos de la clínica pedida, ordenados por hora', () => {
    const agenda = crearAgenda();
    agenda.reservar(reservaValida({ inicio: new Date('2026-09-08T11:00:00') }));
    agenda.reservar(reservaValida({ inicio: new Date('2026-09-08T10:00:00') }));
    agenda.reservar(reservaValida({ clinicaId: 'clinica-2' }));

    const turnos = agenda.listar('clinica-1');
    expect(turnos).toHaveLength(2);
    expect(turnos.map((t) => t.inicio.getHours())).toEqual([10, 11]);
  });

  test('cancelar libera el horario y avisa si el turno no existe', () => {
    const agenda = crearAgenda();
    const turno = agenda.reservar(reservaValida());

    expect(agenda.cancelar(turno.id)).toBe(true);
    expect(agenda.listar('clinica-1')).toHaveLength(0);
    expect(agenda.cancelar('t-999')).toBe(false);
    expect(agenda.reservar(reservaValida()).id).toBe('t-2');
  });
});
