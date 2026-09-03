# Parte 2 — Caso de estudio y diseño de flujo CI/CD

**Caso:** MediTurno SpA (empresa ficticia) · **Herramienta:** GitHub Actions · **Destino:** AWS ECS Fargate

---

## 1. Contexto de la empresa

MediTurno es una empresa de siete personas que vende un sistema web de agendamiento de horas
médicas a clínicas y consultas privadas pequeñas. Hoy atiende a 34 clínicas activas y unas
40.000 reservas mensuales. Es un producto en horario crítico: entre las 08:00 y las 20:00
hábiles, una caída deja a los mesones de recepción anotando pacientes en papel.

| Dimensión | Situación |
|---|---|
| Tipo de software | Aplicación web SaaS multi-inquilino (B2B) con API pública de integración |
| Stack | TypeScript/NestJS · React + Vite · PostgreSQL 16 · Redis · Docker |
| Equipo | 1 tech lead, 3 backend, 2 frontend, 1 QA. **Sin equipo de operaciones** |
| Repositorio | Monorepo en GitHub, trunk-based, PR obligatorio |
| Ambientes | staging (datos sintéticos) y producción (ECS Fargate multi-AZ) |
| Normativa | Datos de salud: trazabilidad de despliegues y respaldo previo a cambios de esquema |

## 2. Necesidades de despliegue

El proceso actual es manual: el tech lead compila localmente, copia el artefacto al servidor y
corre las migraciones a mano, los viernes por la noche. Problemas que el flujo debe resolver:

- Cuello de botella en una sola persona.
- Lotes semanales grandes: cuando algo falla, no se sabe cuál de los ~30 commits lo rompió.
- Rollback por recompilación: 40–60 minutos con el sistema degradado.
- Pruebas ejecutadas de forma inconsistente en local.
- Migraciones sin respaldo previo (dos incidentes en el último año).
- Sin registro auditable que vincule versión en producción ↔ código ↔ aprobación.

**Objetivos del diseño:** desplegar en horario hábil sin caída perceptible; que cualquier
integrante pueda liberar; que ningún cambio llegue a producción sin pruebas verdes; revertir
en menos de cinco minutos.

## 3. Diagrama del flujo

```
                    git push · rama de trabajo
                               │
   ┌───────────────────────────▼───────────────────────────┐  INTEGRACIÓN CONTINUA
   │            lint · prettier · tsc --noEmit             │  (cada Pull Request, ≈8 min)
   │            ┌────────┬───────┴┬─────────┬────────┐     │
   │       Compilación  Unitarias  Integración  Seguridad  │
   │        api + web   cob. ≥80%  PostgreSQL   CodeQL/    │
   │                                    16       Trivy     │
   │            └────────┴────────┬┴─────────┴────────┘     │
   │          docker build → ghcr.io/mediturno/api:$SHA    │
   └───────────────────────────┬───────────────────────────┘
                               ╎ (humano)
        ┌──────────────────────▼──────────────────────┐
        │  PUERTA 1 — revisión de código por un par   │
        │  todos los checks en verde → merge a main   │
        └──────────────────────┬──────────────────────┘
   ┌───────────────────────────▼───────────────────────────┐  ENTREGA CONTINUA
   │  Migraciones ──► ECS Fargate staging ──► Humo E2E     │  staging automático (≈5 min)
   │  reversibles     wait services-stable   playwright    │
   └───────────────────────────┬───────────────────────────┘
                               ╎ (humano)
        ┌──────────────────────▼──────────────────────┐
        │  PUERTA 2 — aprobación manual del release   │
        │  GitHub Environments · aprobador ≠ autor    │
        └──────────────────────┬──────────────────────┘
   ┌───────────────────────────▼───────────────────────────┐  PRODUCCIÓN
   │ Respaldo ─► Blue/Green ─► Verificación ─► Tag + aviso │  blue/green (≈6 min)
   │ snapshot    codedeploy    5 min métricas   git tag    │
   │                 ▲              ╎                      │
   │                 └──────────────┘                      │
   │      error >1% o p95 >800 ms → rollback automático    │
   └───────────────────────────────────────────────────────┘
```

Punto clave: la imagen se construye **una sola vez**, etiquetada con el SHA del commit, y esa
misma imagen se promueve a staging y a producción. Nunca se recompila por ambiente.

## 4. Etapas en detalle

| Etapa | Qué ejecuta | Criterio de rechazo | Tiempo |
|---|---|---|---|
| Calidad estática | ESLint, Prettier, `tsc --noEmit` | Cualquier error de lint, formato o tipos | ~1 min |
| Compilación | Transpilación API + empaquetado web; artefacto publicado | Fallo de compilación | ~2 min |
| Pruebas unitarias | Jest en matriz Node 20 y 22 con umbral de cobertura | Prueba roja o cobertura <80% líneas / <75% ramas | ~3 min |
| Pruebas de integración | Suite contra PostgreSQL 16 y Redis reales; aplica, revierte y reaplica la migración | Prueba roja o migración no reversible | ~4 min |
| Seguridad | CodeQL, `npm audit`, gitleaks, Trivy sobre la imagen | Vulnerabilidad alta/crítica o secreto filtrado | ~3 min |
| Empaquetado | `docker build` con caché de capas → GHCR con etiqueta del commit | Fallo de build o de escaneo | ~2 min |
| Despliegue staging | Migraciones, `ecs update-service`, espera de estabilidad, Playwright `@smoke` | Servicio inestable o humo rojo | ~5 min |
| Despliegue producción | Snapshot RDS, migración compatible, blue/green, verificación 5 min | Error >1% o p95 >800 ms → reversión automática | ~6 min |

Las pruebas y el análisis de seguridad corren en paralelo porque no dependen entre sí; la
calidad estática va sola y primero: un error de tipos invalida todo lo demás y cuesta un
minuto detectarlo en vez de ocho.

## 5. Justificación técnica

### Elección de la herramienta

| Opción | A favor | En contra para este equipo |
|---|---|---|
| **GitHub Actions (elegida)** | El código ya vive en GitHub: cero infraestructura que administrar; los checks se integran con las reglas de protección de rama; *Environments* aporta la aprobación manual y el registro de auditoría; OIDC elimina llaves estáticas de AWS | Dependencia de proveedor; costo por minuto si el pipeline se descuida |
| Jenkins | Máxima flexibilidad, sin licencia | Exige servidor, actualizaciones y gestión de plugins: trabajo de operaciones que un equipo sin personal de infraestructura no puede sostener |
| GitLab CI | Modelo de pipeline maduro | Obligaría a migrar repositorio, issues e historial de PR sin ganancia proporcional |

### Decisiones de diseño

1. **Un artefacto, tres ambientes.** Si funcionó en staging, lo que llega a producción no es
   equivalente: es idéntico.
2. **Puerta humana solo en producción.** Staging da retroalimentación en minutos sin fricción;
   la aprobación manual se reserva para el único punto con pacientes reales, y queda registrada
   (quién aprobó qué versión) — la trazabilidad que exige la auditoría.
3. **Blue/green en vez de reemplazo directo.** La versión nueva se levanta en paralelo y el
   balanceador cambia el tráfico tras el health check: permite desplegar en horario de atención
   y revertir devolviendo el tráfico al grupo anterior, que sigue vivo.
4. **Migraciones compatibles hacia atrás.** Toda migración debe funcionar con la versión
   anterior del código; de lo contrario el rollback exigiría revertir datos.
5. **Verificación antes de declarar éxito.** Un despliegue exitoso no es el que terminó sin
   error, sino el que sostuvo sus métricas cinco minutos.
6. **Seguridad dentro del pipeline.** SAST, dependencias, secretos e imagen se revisan en cada
   PR y bloquean el merge; un control que no bloquea es un informe, no un control.

### Resultado esperado (métricas DORA)

| Métrica | Antes | Con el flujo propuesto |
|---|---|---|
| Frecuencia de despliegue | 1 por semana | 8–10 por semana |
| Tiempo de commit a producción | hasta 5 días | < 1 hora |
| Tiempo de restauración | 40–60 min | < 5 min |
| Cambios fallidos | ~20% | < 8% |

## 6. Archivos del entregable

- `.github/workflows/ci.yml` — integración continua completa.
- `.github/workflows/cd.yml` — entrega y despliegue con puerta manual y rollback.
- `docs/parte2-cicd.html` — informe con el diagrama vectorial.

---

*MediTurno SpA es una empresa ficticia creada para este caso de estudio. Los nombres de
servicios, umbrales y métricas son ilustrativos y coherentes entre sí, pero no corresponden a
un sistema en operación.*
