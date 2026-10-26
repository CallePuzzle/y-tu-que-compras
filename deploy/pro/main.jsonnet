local app = import 'app.libsonnet';

{
  app: app {
    values+: {
      // Dominio público de la app (Cloudflare proxied → LB OCI → Traefik).
      serverAlias: 'ytqc.callepuzzle.com',
    },
  },
}
