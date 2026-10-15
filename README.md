# y-tu-que-compras

Aplicación SvelteKit 2 + Svelte 5. Gestor de paquetes: [bun](https://bun.sh).

## Requisitos

Versiones fijadas en `.tool-versions` (asdf): node y bun.

```sh
asdf install
```

La autenticación contra GitHub Packages (`@callepuzzle/*`, `@zytera/*`) se resuelve con un
[Personal Access Token](https://github.com/settings/tokens) clásico con permiso `read:packages`.
Defínelo como `NPM_TOKEN` en el `.env` (ver `.env.example`): el `.npmrc` lo inyecta
(`//npm.pkg.github.com/:_authToken=${NPM_TOKEN}`). Sin token, `bun install` falla con 401.

## Instalación

```sh
bun install
```

## Developing

Once you've created a project and installed dependencies, start a development server:

```sh
bun run dev

# or start the server and open the app in a new browser tab
bun run dev -- --open
```

## Building

To create a production version of your app:

```sh
bun run build
```

You can preview the production build with `bun run preview`.

## Comprobaciones

```sh
bun run lint   # prettier + eslint
bun run check  # svelte-check
bun run test   # unit + e2e
```

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
