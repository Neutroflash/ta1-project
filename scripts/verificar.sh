#!/usr/bin/env bash
# Verificación posterior al despliegue.
#
#   ./scripts/verificar.sh http://127.0.0.1:8090 --peticiones 40 --error-max 1 --p95-max 800
#
# Un despliegue no es exitoso porque el comando haya terminado, sino porque la
# versión nueva sostiene sus métricas. Este script manda tráfico real contra el
# despliegue y compara la tasa de error y la latencia p95 con sus umbrales.

set -euo pipefail

BASE="${1:?Uso: verificar.sh <url-base> [--peticiones N] [--error-max %] [--p95-max ms]}"
shift

PETICIONES=40
ERROR_MAX=1
P95_MAX=800

while [ $# -gt 0 ]; do
  case "$1" in
    --peticiones) PETICIONES="$2"; shift 2 ;;
    --error-max)  ERROR_MAX="$2";  shift 2 ;;
    --p95-max)    P95_MAX="$2";    shift 2 ;;
    *) echo "Opción desconocida: $1"; exit 2 ;;
  esac
done

echo "Verificando ${BASE}: ${PETICIONES} peticiones, error <= ${ERROR_MAX}%, p95 <= ${P95_MAX} ms"

errores=0
latencias=()

for _ in $(seq 1 "$PETICIONES"); do
  # %{http_code} y %{time_total} en una sola llamada: un dato por petición.
  respuesta=$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 5 "${BASE}/health" || echo "000 5")
  estado="${respuesta% *}"
  segundos="${respuesta#* }"

  if [ "$estado" != "200" ]; then
    errores=$((errores + 1))
  fi
  latencias+=("$(awk -v s="$segundos" 'BEGIN { printf "%d", s * 1000 }')")
done

tasa_error=$(awk -v e="$errores" -v n="$PETICIONES" 'BEGIN { printf "%.2f", (e / n) * 100 }')

# p95 = el percentil 95 de las latencias ordenadas.
indice=$(awk -v n="$PETICIONES" 'BEGIN { i = int(n * 0.95); print (i < 1 ? 1 : i) }')
p95=$(printf '%s\n' "${latencias[@]}" | sort -n | sed -n "${indice}p")

echo "  tasa de error: ${tasa_error}% (umbral ${ERROR_MAX}%)"
echo "  latencia p95:  ${p95} ms (umbral ${P95_MAX} ms)"

fuera_de_rango=$(awk -v te="$tasa_error" -v em="$ERROR_MAX" -v p="$p95" -v pm="$P95_MAX" \
  'BEGIN { print (te > em || p > pm) ? 1 : 0 }')

if [ "$fuera_de_rango" -eq 1 ]; then
  echo "Verificación FALLIDA: la versión nueva no sostiene sus métricas."
  exit 1
fi

echo "Verificación superada: la versión nueva se mantiene dentro de los umbrales."
