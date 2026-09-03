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
| [`.github/workflows/cd.yml`](.github/workflows/cd.yml) | Entrega y despliegue **simulado**: staging automático, blue/green, verificación y rollback, todo sobre contenedores en el runner |
| [`docs/cd-aws-referencia.yml`](docs/cd-aws-referencia.yml) | El mismo flujo apuntando a infraestructura real (ECS Fargate, RDS, CodeDeploy, OIDC), como referencia de diseño |
| [`scripts/humo.sh`](scripts/humo.sh), [`scripts/verificar.sh`](scripts/verificar.sh) | Pruebas de humo y verificación de métricas post-despliegue |

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

> **Ambos pipelines se ejecutan de verdad en GitHub Actions.** El CI corre sobre la aplicación
> de ejemplo: calidad estática, compilación, pruebas unitarias con cobertura, pruebas de
> integración contra PostgreSQL y escaneo de la imagen Docker.
>
> Como el caso de estudio no tiene una cuenta de AWS detrás, el CD **simula** el despliegue con
> contenedores en el propio runner: staging y los grupos azul/verde son contenedores que se
> levantan, se verifican con tráfico real y se dan de baja. El escaneo de imagen quedó como
> informativo por el mismo motivo: las CVE que reporta vienen de la imagen base de Alpine y no
> dependen del proyecto. En MediTurno ambos bloquearían la entrega.

---

MediTurno SpA es una empresa ficticia creada para este caso de estudio.
