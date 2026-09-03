# TA1 — Parte 2: Caso de estudio y diseño de flujo CI/CD

Entrega de la Parte 2: caso empresarial ficticio (**MediTurno SpA**, SaaS de agendamiento de
horas médicas) y diseño de un flujo CI/CD automatizado sobre **GitHub Actions**, con
compilación, pruebas automatizadas y despliegue a AWS ECS Fargate.

## Aplicación de ejemplo

Para que el pipeline se ejecute de verdad (y no solo describa un diseño), el repositorio
incluye una implementación mínima de la API de turnos:

| Archivo | Qué hace |
|---|---|
| `src/index.js` | Punto de entrada: elige la agenda (memoria o PostgreSQL) y levanta el servidor |
| `src/agenda.js` | Reglas de negocio: horario 08:00–20:00, bloques de 15 min, sin solapes |
| `src/servidor.js` | API HTTP: `GET /health`, `GET /api/turnos`, `POST /api/turnos` |
| `src/db.js` | Misma agenda respaldada por PostgreSQL |
| `migrations/`, `scripts/migrate.js` | Esquema y migrador reversible (el CI aplica, revierte y reaplica) |
| `tests/` | 26 pruebas unitarias y 5 de integración contra PostgreSQL real |

```bash
npm install
npm start                 # http://localhost:3000/health
npm run lint && npm run typecheck && npm run test:unit
```

## Contenido

| Archivo | Descripción |
|---|---|
| [`docs/parte2-cicd.md`](docs/parte2-cicd.md) | Informe completo: contexto, necesidades, diagrama del flujo, etapas y justificación técnica |
| [`docs/parte2-cicd.html`](docs/parte2-cicd.html) | El mismo informe con el diagrama vectorial |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Integración continua: calidad estática, compilación, pruebas unitarias y de integración, seguridad e imagen Docker |
| [`.github/workflows/cd.yml`](.github/workflows/cd.yml) | Entrega y despliegue: staging automático, aprobación manual, blue/green, verificación y rollback |

## Resumen del flujo

```
push → CI (lint/tipos → compilación ∥ unitarias ∥ integración ∥ seguridad → imagen :SHA)
     → puerta 1: revisión de un par → merge a main
     → staging automático (migraciones → ECS → pruebas de humo)
     → puerta 2: aprobación manual
     → producción blue/green → verificación 5 min → rollback automático si falla
```

La imagen se construye **una sola vez** y se promueve sin recompilar: staging y producción
ejecutan exactamente el mismo binario.

> **El CI se ejecuta de verdad** sobre la aplicación de ejemplo: calidad estática, compilación,
> pruebas unitarias con cobertura, pruebas de integración contra PostgreSQL y escaneo de la
> imagen Docker.
>
> El CD, en cambio, apunta a una infraestructura ficticia (cuentas AWS, secretos y scripts de
> despliegue que no existen), así que sus jobs solo corren si el repositorio define la variable
> `DESPLIEGUE_HABILITADO=true`. Igual queda como diseño legible y defendible.

---

MediTurno SpA es una empresa ficticia creada para este caso de estudio.
