#!/usr/bin/env bash
# Pruebas de humo contra un despliegue ya levantado.
#
#   ./scripts/humo.sh http://127.0.0.1:8081
#
# Comprueba el camino que una recepcionista recorre de verdad: el servicio
# responde, se puede reservar una hora, y el sistema impide reservar dos veces
# el mismo bloque.

set -euo pipefail

BASE="${1:?Uso: humo.sh <url-base>}"
# Cada corrida usa su propia clínica para no chocar con datos de una anterior.
CLINICA="humo-${RANDOM}${RANDOM}"
fallos=0

comprobar() {
  local descripcion="$1" esperado="$2" obtenido="$3"
  if [ "$esperado" = "$obtenido" ]; then
    echo "  ok    ${descripcion} (${obtenido})"
  else
    echo "  FALLA ${descripcion}: se esperaba ${esperado} y llegó ${obtenido}"
    fallos=$((fallos + 1))
  fi
}

codigo() {
  curl -s -o /dev/null -w '%{http_code}' "$@"
}

reserva() {
  printf '{"clinicaId":"%s","paciente":"%s","inicio":"%s","duracionMin":30}' \
    "$CLINICA" "$1" "$2"
}

echo "Pruebas de humo contra ${BASE}"

comprobar "el servicio responde" 200 "$(codigo "${BASE}/health")"

comprobar "reservar una hora" 201 \
  "$(codigo -X POST "${BASE}/api/turnos" -H 'content-type: application/json' \
      -d "$(reserva 'Ana Rojas' '2026-09-08T09:00:00')")"

comprobar "rechazar una hora ya tomada" 409 \
  "$(codigo -X POST "${BASE}/api/turnos" -H 'content-type: application/json' \
      -d "$(reserva 'Luis Paredes' '2026-09-08T09:15:00')")"

comprobar "rechazar datos incompletos" 400 \
  "$(codigo -X POST "${BASE}/api/turnos" -H 'content-type: application/json' \
      -d "$(reserva '' '2026-09-08T11:00:00')")"

# awk en vez de grep: grep sin coincidencias devuelve 1 y, con `pipefail`,
# abortaría el script justo cuando la comprobación debería informar el fallo.
turnos=$(curl -s "${BASE}/api/turnos?clinicaId=${CLINICA}" | awk -F'"id"' '{print NF - 1}')
comprobar "la hora reservada queda en la agenda" 1 "$turnos"

if [ "$fallos" -gt 0 ]; then
  echo "Pruebas de humo: ${fallos} fallo(s)."
  exit 1
fi
echo "Pruebas de humo: todo en orden."
