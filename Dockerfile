# Dependencias de producción, aisladas para copiarlas a la imagen final.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Compilación: instala todo, genera el bundle y se descarta.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Imagen final: solo Node, las dependencias de producción y el bundle.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# En producción no se instala nada, así que npm sobra. Quitarlo elimina de raíz
# las vulnerabilidades de las dependencias que trae empaquetadas (node-tar),
# que es lo que hacía fallar el escaneo de Trivy.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Nunca como root: ECS ejecuta la tarea con este usuario.
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
