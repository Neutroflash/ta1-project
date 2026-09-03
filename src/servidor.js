'use strict';

const http = require('node:http');
const { crearAgenda, ErrorDeAgenda } = require('./agenda');

/** Códigos de negocio que corresponden a un conflicto, no a un dato inválido. */
const CODIGOS_DE_CONFLICTO = new Set(['HORARIO_OCUPADO']);

/**
 * @param {http.ServerResponse} res
 * @param {number} estado
 * @param {unknown} cuerpo
 */
function responder(res, estado, cuerpo) {
  const json = JSON.stringify(cuerpo);
  res.writeHead(estado, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
  });
  res.end(json);
}

/**
 * @param {http.IncomingMessage} req
 * @returns {Promise<any>}
 */
async function leerJson(req) {
  const trozos = [];
  for await (const trozo of req) {
    trozos.push(trozo);
  }
  if (trozos.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(trozos).toString('utf8'));
}

/**
 * Crea el servidor HTTP de la API. Se inyecta la agenda para poder probarlo
 * con una agenda en memoria y ejecutarlo con la de PostgreSQL.
 *
 * @param {{ agenda?: import('./agenda').Agenda }} [opciones]
 * @returns {http.Server}
 */
function crearServidor(opciones = {}) {
  const agenda = opciones.agenda ?? crearAgenda();

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return responder(res, 200, { estado: 'ok', version: process.env.APP_VERSION ?? 'dev' });
      }

      if (req.method === 'GET' && url.pathname === '/api/turnos') {
        const clinicaId = url.searchParams.get('clinicaId');
        if (!clinicaId) {
          return responder(res, 400, { codigo: 'CLINICA_REQUERIDA' });
        }
        return responder(res, 200, { turnos: await agenda.listar(clinicaId) });
      }

      if (req.method === 'POST' && url.pathname === '/api/turnos') {
        const cuerpo = await leerJson(req);
        const turno = await agenda.reservar(cuerpo);
        return responder(res, 201, { turno });
      }

      return responder(res, 404, { codigo: 'NO_ENCONTRADO' });
    } catch (error) {
      if (error instanceof ErrorDeAgenda) {
        const estado = CODIGOS_DE_CONFLICTO.has(error.codigo) ? 409 : 400;
        return responder(res, estado, { codigo: error.codigo, mensaje: error.message });
      }
      if (error instanceof SyntaxError) {
        return responder(res, 400, { codigo: 'JSON_INVALIDO' });
      }
      return responder(res, 500, { codigo: 'ERROR_INTERNO' });
    }
  });
}

module.exports = { crearServidor };
