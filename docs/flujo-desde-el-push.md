# Qué pasa cuando subes código a una rama remota

Recorrido completo de un cambio en este repositorio, desde `git push` hasta que queda
desplegado. Todos los tiempos y resultados provienen de corridas reales, no de estimaciones.

---

## Resumen

```
  git push origin feat/mi-rama
          │
          ▼
  ┌───────────────────────────────────────────────┐
  │  CI  ·  evento: push                          │   ~1.5 min
  │  Valida el código antes de que nadie lo mire  │
  └───────────────────────────────────────────────┘
          │
          ▼  abres el Pull Request
  ┌───────────────────────────────────────────────┐
  │  CI  ·  evento: pull_request                  │   ~1.5 min
  │  La misma suite + revisión de un par          │
  └───────────────────────────────────────────────┘
          │
          ▼  PUERTA 1 · alguien aprueba y hace merge
  ┌───────────────────────────────────────────────┐
  │  CD  ·  evento: push a main                   │   ~46 s
  │  staging → PUERTA 2 → producción blue/green   │
  └───────────────────────────────────────────────┘
          │
          ▼
     versión en producción
```

**Dos puertas humanas y ninguna recompilación.** La imagen se construye una vez y esa misma
imagen es la que se verifica en staging y la que se promueve a producción.

---

## Paso 0 — Qué dispara qué

| Lo que haces | Evento de GitHub | Workflow que corre |
|---|---|---|
| `git push` a cualquier rama que no sea `main` | `push` | **CI** |
| Abrir o actualizar un PR hacia `main` | `pull_request` | **CI** |
| Hacer merge del PR (push a `main`) | `push` en `main` | **CD** |
| Botón *Run workflow* en la pestaña Actions | `workflow_dispatch` | **CD** |

El CI se define en [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) y excluye `main`
con `branches-ignore`, para no repetir en el merge lo que ya se validó en el PR.

---

## Etapa 1 — El CI, al hacer push a la rama

Seis jobs. El primero corre solo; los cuatro siguientes en paralelo; el último espera a todos.

```
  calidad ──┬── compilacion ─────────┐
            ├── pruebas-unitarias ───┤
            ├── pruebas-integracion ─┼──► imagen
            └── seguridad ───────────┘
```

### 1. `calidad` — Lint, formato y tipos · 16 s

ESLint, Prettier y `tsc --noEmit`. Va solo y primero **a propósito**: un error de tipos
invalida todo lo demás, y cuesta 16 segundos descubrirlo en vez de esperar el minuto y medio
completo. Si este job falla, los otros cinco ni siquiera arrancan.

> En este proyecto el `typecheck` no es decorativo: encontró que el servidor devolvía una
> promesa sin resolver al usar la agenda de PostgreSQL, porque la de memoria es síncrona.

### 2. `compilacion` — 15 s

`esbuild` genera `dist/index.js` y lo publica como artefacto de la corrida (7 días de
retención). Es el mismo bundle que después entra en la imagen Docker.

### 3. `pruebas-unitarias` — 15 s (Node 20) y 19 s (Node 22)

Matriz de dos versiones de Node, en paralelo. Jest con umbral de cobertura: **80% de líneas y
75% de ramas**. Si la cobertura baja del umbral, el job falla aunque todas las pruebas pasen.

Cobertura actual: 98.8% de líneas, 95.2% de ramas sobre `src/agenda.js` y `src/servidor.js`.

### 4. `pruebas-integracion` — 34 s

GitHub levanta **PostgreSQL 16 y Redis como contenedores de servicio** junto al job. Entonces:

1. Aplica las migraciones (`db:migrate:deploy`).
2. **Las revierte y las vuelve a aplicar** (`db:migrate:down` y otra vez `deploy`).
3. Corre la suite contra esa base real.

El paso 2 es la parte que más incidentes evita: comprueba que la migración es reversible
*antes* de que haga falta revertirla en producción a las tres de la mañana.

### 5. `seguridad` — 69 s

Cuatro controles, y es el job más lento del pipeline:

| Control | Qué busca |
|---|---|
| CodeQL | Vulnerabilidades en el propio código (SAST) |
| `npm audit --audit-level=high` | Dependencias con vulnerabilidades altas o críticas |
| gitleaks | Credenciales filtradas en el historial de git |

### 6. `imagen` — Construir y escanear

Espera a los cuatro anteriores. Construye la imagen Docker, **la carga en el runner** y la
escanea con Trivy antes de publicarla — escanear después de publicar llega tarde. Solo sube la
imagen a GHCR si el repositorio define la variable `PUBLICAR_IMAGEN=true`.

**Total del CI: 92 segundos de punta a punta.**

---

## Etapa 2 — El Pull Request

Abrir el PR dispara la misma suite, ahora sobre el evento `pull_request`. Aquí está la
**Puerta 1**: la revisión humana. Los checks en verde son condición necesaria, no suficiente;
alguien tiene que leer el cambio.

Para que la puerta sea real y no una costumbre, en *Settings → Branches* se protege `main`
exigiendo PR, checks en verde y al menos una aprobación.

---

## Etapa 3 — El merge a `main` dispara el CD

El CD ([`.github/workflows/cd.yml`](../.github/workflows/cd.yml)) simula el despliegue con
contenedores en el propio runner, porque este caso de estudio no tiene una cuenta de AWS
detrás. El flujo equivalente sobre ECS Fargate, RDS y CodeDeploy está en
[`docs/cd-aws-referencia.yml`](cd-aws-referencia.yml).

### `staging` — automático, sin intervención

1. Construye la imagen de la versión.
2. Levanta el contenedor y **espera a que responda sano** (equivale a `aws ecs wait
   services-stable`).
3. Corre [`scripts/humo.sh`](../scripts/humo.sh), que recorre el camino real de una
   recepcionista:

   ```
   ok    el servicio responde (200)
   ok    reservar una hora (201)
   ok    rechazar una hora ya tomada (409)
   ok    rechazar datos incompletos (400)
   ok    la hora reservada queda en la agenda (1)
   ```

Si el humo falla, el despliegue a producción no ocurre: `needs: staging`.

### `produccion` — blue/green con verificación y rollback

Aquí está la **Puerta 2**. El job declara `environment: produccion`; si en *Settings →
Environments* se le exige un revisor, el job **queda esperando la aprobación manual** y registra
quién aprobó qué versión — que es exactamente la trazabilidad que pide una auditoría.

Luego:

| Paso | Qué hace |
|---|---|
| **Grupo azul** | La versión que ya está atendiendo tráfico (puerto 8080) |
| **Grupo verde** | La versión nueva se levanta **en paralelo**, sin tocar a la azul |
| **Cambio de tráfico** | Solo ocurre si verde responde sano y pasa las pruebas de humo |
| **Verificación** | [`scripts/verificar.sh`](../scripts/verificar.sh) manda 40 peticiones reales y mide tasa de error y latencia p95 |
| **Rollback** | Si la verificación falla, devuelve el tráfico al grupo azul, que nunca se apagó |
| **Retiro del azul** | Solo cuando todo lo anterior salió bien |

Medición de la última corrida real:

```
Verificando http://127.0.0.1:8090: 40 peticiones, error <= 1%, p95 <= 800 ms
  tasa de error: 0.00% (umbral 1%)
  latencia p95:  0 ms (umbral 800 ms)
Verificación superada: la versión nueva se mantiene dentro de los umbrales.
```

**Total del CD: 46 segundos.** El paso de rollback aparece como `skipped`, que es justamente lo
que debe pasar cuando el despliegue va bien.

> La idea de fondo: **un despliegue exitoso no es el que terminó sin error, sino el que sostuvo
> sus métricas.** Por eso el pipeline mide antes de declarar la victoria y retirar la versión
> anterior.

---

## Qué pasa cuando algo falla

| Falla | Consecuencia |
|---|---|
| Lint, formato o tipos | Se detiene todo el CI en 16 s; los demás jobs no arrancan |
| Una prueba unitaria o la cobertura baja del umbral | El job falla y el PR queda bloqueado |
| Una migración no se puede revertir | Falla integración: no llega a producción una migración sin vuelta atrás |
| Vulnerabilidad alta con parche disponible | El control la reporta (en MediTurno además bloquea el merge) |
| Las pruebas de humo en staging | Producción no se despliega: `needs: staging` |
| La verificación en producción | Rollback automático al grupo azul, que sigue vivo |

---

## Reproducir el pipeline en tu máquina

Los mismos comandos que ejecuta el CI, sin esperar al runner:

```bash
npm ci
npm run lint && npm run format:check && npm run typecheck
npm run test:unit -- --coverage
npm run build

# Pruebas de integración: necesitan PostgreSQL
docker run -d --name pg -e POSTGRES_USER=mediturno -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=mediturno_test -p 5432:5432 postgres:16-alpine
export DATABASE_URL="postgresql://mediturno:test@localhost:5432/mediturno_test"
npm run db:migrate:deploy && npm run test:integration

# El despliegue simulado, igual que en el CD
docker build -t mediturno/api:local .
docker run -d --name verde -p 8090:3000 mediturno/api:local
./scripts/humo.sh http://127.0.0.1:8090
./scripts/verificar.sh http://127.0.0.1:8090 --peticiones 40 --error-max 1 --p95-max 800
```

---

## Corridas de referencia

| Workflow | Evento | Resultado | Duración |
|---|---|---|---|
| CI | `push` a `feat/first-change` | 7 jobs en verde | 92 s |
| CD | `push` a `main` (merge del PR #1) | staging y producción en verde | 46 s |

Historial completo en la [pestaña Actions](https://github.com/Neutroflash/ta1-project/actions).
