'use strict';

/**
 * Punto de entrada de la API de MediTurno.
 *
 * Solo decide dónde viven los datos y levanta el servidor: la lógica está en
 * `agenda.js` y `servidor.js`, que son los módulos que cubren las pruebas.
 */

const { crearServidor } = require('./servidor');
const { crearAgenda } = require('./agenda');

const PUERTO = Number(process.env.PORT ?? 3000);

// Sin DATABASE_URL levanta con agenda en memoria: sirve para desarrollo local
// y para las pruebas de humo del pipeline.
const agenda = process.env.DATABASE_URL ? require('./db').crearAgendaPg() : crearAgenda();

const servidor = crearServidor({ agenda });

servidor.listen(PUERTO, () => {
  console.log(`MediTurno API escuchando en el puerto ${PUERTO}`);
});

// ECS envía SIGTERM al reemplazar la tarea: cerramos sin cortar peticiones en curso.
process.on('SIGTERM', () => {
  console.log('SIGTERM recibido, cerrando el servidor...');
  servidor.close(() => process.exit(0));
});

module.exports = { servidor };
