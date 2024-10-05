# Esqueleto de una aplicación con Svelte 5

Este repositorio es una plantilla para generar aplicaciones con Svelte Kit usando Svelte 5.

Incluye:

- El [conector](https://kit.svelte.dev/docs/adapter-cloudflare-workers) de Cloudflare Workers para desplegar la aplicación.
- [daisyUI](https://daisyui.com) como librería de componentes para Tailwind CSS.
- [prisma](https://www.prisma.io) como ORM para la base de datos usando [D1 Database](https://developers.cloudflare.com/d1) de Cloudflare
- Gestión de usuarios y sesiones usando:
  - [Lucia Auth](https://lucia-auth.com) con el adaptador de SQLite que funciona con D1 Database.
  - [Arctic](https://arctic.js.org) como librería de Oauth2, usando el adaptador de Auth0.

## D1 Database

Cómo generar la primera migración:

```bash
npx prisma migrate diff \
    --from-empty \
    --to-schema-datamodel ./prisma/schema.prisma \
    --script \
    --output migrations/0001_initial.sql
```

Cómo aplicar migraciones:

```bash
npx wrangler d1 migrations apply svelte-test --local
npx prisma generate
```
