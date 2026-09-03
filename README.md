# TA1 — Parte 2: Caso de estudio y diseño de flujo CI/CD

Entrega de la Parte 2: caso empresarial ficticio (**MediTurno SpA**, SaaS de agendamiento de
horas médicas) y diseño de un flujo CI/CD automatizado sobre **GitHub Actions**, con
compilación, pruebas automatizadas y despliegue a AWS ECS Fargate.

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

> Los workflows están escritos para ser legibles y defendibles como diseño; describen una
> infraestructura ficticia (cuentas AWS, secretos y scripts de despliegue no incluidos), por lo
> que no se ejecutan tal cual en este repositorio.

---

MediTurno SpA es una empresa ficticia creada para este caso de estudio.
