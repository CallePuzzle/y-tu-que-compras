# syntax=docker/dockerfile:1
# Imagen de producción (fase 3 de la issue #30 de villajilguero-oci-services:
# despliegue en el clúster k0s). Multi-stage, todo bun como Zytera/auth: build
# con oven/bun (compila SvelteKit con ADAPTER=node) y runtime
# oven/bun:1.4.4-distroless, que ejecuta el servidor de adapter-node con el
# propio bun (`bun run build/index.js`): adapter-node es JS puro sobre APIs de
# node que bun implementa, y el cliente de Prisma va con el driver adapter
# @prisma/adapter-pg (sin binario Rust en runtime). Solo el CLI de `prisma`
# (migraciones, init container db-migrate) usa el binario schema-engine que
# descarga el postinstall de @prisma/engines. La imagen final se publica
# linux/arm64: el clúster corre en OCI VM.Standard.A1.Flex (aarch64) y el
# workflow de release construye en el runner nativo ubuntu-24.04-arm, así que
# aquí no hay nada arch-específico.

# Dependencias completas (devDeps incluidos: vite, svelte, typescript...). El
# install va en su propia capa con solo los manifiestos (issue #123): un cambio
# de código no reinstala nada mientras no cambien package.json/bun.lock.
# Por eso `--ignore-scripts`: el postinstall de package.json genera código
# (svelte-kit sync, prisma generate, paraglide compile) a partir del fuente,
# que aún no está; se ejecuta abajo, tras el COPY. De los scripts de
# dependencias solo importa el de @prisma/engines (descarga el schema-engine
# que usará el init container db-migrate), que se lanza a mano aquí — el de
# esbuild solo verifica el binario de su paquete opcional y el preinstall de
# prisma solo comprueba versiones.
FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock .npmrc ./
# NPM_TOKEN entra como secret de BuildKit: no queda en ARG/ENV ni en ninguna
# capa. Lo expande el .npmrc (que se entrega sin secretos) al resolver los
# paquetes @callepuzzle/* y @zytera/* de GitHub Packages.
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN="$(cat /run/secrets/npm_token)" bun install --frozen-lockfile --ignore-scripts && \
    cd node_modules/@prisma/engines && bun run postinstall
COPY . .
RUN bun run postinstall
# ADAPTER=node: svelte.config.js elige adapter-node y genera `build/` (la build
# de Vercel, que no define esta variable, sigue generando .vercel/output).
ENV ADAPTER=node
RUN bun run build

# Poda del árbol de dependencias para el runtime. `bun install --production` de
# bun 1.4.4 instala devDeps igualmente (bug verificado en 1.4.3 y 1.4.4, con y
# sin lockfile), distroless no trae npm, y npm prune no poda un árbol instalado
# por bun (sin package-lock da el árbol por bueno y casi no quita nada). Así que
# se podan los devDeps con el propio bun (`bun remove` re-resuelve el árbol
# respetando los pins del lockfile), EXCEPTO los que el servidor necesita en
# runtime: vite no bundla @sveltejs/kit ni svelte en build/server (quedan como
# imports externos), y ambos viven en devDependencies — quitarlos rompería el
# arranque. La lista sale del propio package.json, así que los devDeps nuevos
# quedan cubiertos sin tocar el Dockerfile.
FROM oven/bun:1.4.4 AS prune
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json bun.lock .npmrc ./
RUN --mount=type=secret,id=npm_token \
    export NPM_TOKEN="$(cat /run/secrets/npm_token)" && \
    export KEEP_AT_RUNTIME='svelte @sveltejs/kit' && \
    DEVDEPS="$(bun -e 'const keep = new Set(process.env.KEEP_AT_RUNTIME.split(" ")); console.log(Object.keys(require("./package.json").devDependencies ?? {}).filter((d) => !keep.has(d)).join(" "))')" && \
    bun remove --ignore-scripts $DEVDEPS && rm .npmrc

# Libs compartidas que el schema-engine de Prisma (init container db-migrate)
# enlaza dinámicamente y que la imagen distroless de bun no trae: es estática
# (sin libssl) y `prisma migrate deploy` muere con un "Schema engine error"
# vacío. Bookworm (debian 12) es exactamente el sabor del binario del engine
# (schema-engine-debian-openssl-3.0.x). libgcc/libz/libzstd ya están en la base
# de debian; libssl3 y libbrotli1 van por apt.
FROM debian:12-slim AS enginelibs
RUN apt-get update \
    && apt-get install -y --no-install-recommends libssl3 libbrotli1 \
    && rm -rf /var/lib/apt/lists/*
# Se reúnen en /out porque el directorio multiarch depende de la arquitectura
# del build: x86_64-linux-gnu en un build amd64 y aarch64-linux-gnu en el
# runner arm64 de release (la primera release falló al copiar las rutas
# x86_64 a pelo). /lib es symlink de /usr/lib (usrmerge), así que el glob
# *-linux-* cubre ambas arquitecturas; `cp -L` aplana enlaces.
RUN mkdir -p /out && \
    cp -L /usr/lib/*-linux-*/libssl.so.3 \
          /usr/lib/*-linux-*/libcrypto.so.3 \
          /usr/lib/*-linux-*/libgcc_s.so.1 \
          /usr/lib/*-linux-*/libz.so.1 \
          /usr/lib/*-linux-*/libzstd.so.1 \
          /usr/lib/*-linux-*/libbrotli*.so.1 \
          /out/

# Distroless: sin shell ni package manager. No vale `RUN` y `bun run <script>`
# (scripts de package.json) falla con MissingShell; ejecutar archivos con
# `bun run <ruta>` sí funciona. USER bun no existe aquí (solo root/nonroot):
# en k8s el securityContext fija runAsUser de todas formas (deploy/lib).
FROM oven/bun:1.4.4-distroless AS runtime
WORKDIR /app
ENV NODE_ENV=production
# PORT es la variable del servidor de adapter-node (HOST cae en 0.0.0.0, y no
# se fija aquí por lo mismo que en Zytera/auth: con bun 1.4.4 el bind explícito
# a 0.0.0.0 rompe el publishing de `-p` en docker/podman rootless; en el
# clúster es irrelevante y deploy/ lo inyecta).
ENV PORT=8080
COPY --from=build /app/build ./build
# Para `prisma migrate deploy` (init container db-migrate, ver deploy/lib): el
# config cablea el datasource a DATABASE_URL y necesita dotenv (dependencies).
COPY --from=build /app/prisma.config.ts ./
COPY --from=build /app/prisma ./prisma
COPY package.json ./
# --chown 65532 (nonroot): el CLI de Prisma verifica que puede escribir en su
# directorio de engines y falla con "Can't write to
# /app/node_modules/@prisma/engines" si viene como root (en distroless no hay
# RUN para chown).
COPY --from=prune --chown=65532:65532 /app/node_modules ./node_modules
# Libs para el schema-engine (ver stage enginelibs), a /usr/lib: el loader de
# glibc lo trae entre sus rutas por defecto y la detección de flavor de
# Prisma lo usa como fallback cuando no hay `uname` (en distroless es el
# caso; parsea "libssl.so.3" → flavor debian-openssl-3.0.x).
COPY --from=enginelibs /out/ /usr/lib/
EXPOSE 8080/tcp
USER nonroot
ENTRYPOINT [ "bun", "run", "/app/build/index.js" ]
