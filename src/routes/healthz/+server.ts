import type { RequestHandler } from '@sveltejs/kit';

/**
 * Liveness del clúster (issue #124): responde 200 si el event loop del
 * servidor vive. NO toca la base de datos (para eso está `/readyz`): un
 * apagón de Postgres no debe tumbar los pods, solo sacarlos del balanceo.
 *
 * Ruta pública (exenta en `isPublicPathname`, que es quien la deja pasar sin
 * sesión) y sin log de request (kubelet sondea cada pocos segundos; ver
 * `handleLogging`).
 *
 * Las probes llegan por httpGet desde el kubelet (deploy/lib/app.libsonnet).
 */
export const prerender = false;

export const GET: RequestHandler = () => new Response('ok');
