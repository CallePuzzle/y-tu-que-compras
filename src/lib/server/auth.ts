import prisma from '#lib/server/prisma.js';
import { getBetterAuth } from '@callepuzzle/auth/server';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';

// better-auth no ve el .env via process.env en este setup (bun no lo inyecta en
// los scripts de package.json), asi que baseURL y secret van explicitos desde
// `$env/dynamic/private`: el handle de @callepuzzle/auth corta el arranque si
// faltan. El acceso a `prisma` es perezoso: durante `vite build` no se abre
// ninguna conexion.
export const auth = getBetterAuth({
	baseURL: env.BETTER_AUTH_URL,
	secret: env.BETTER_AUTH_SECRET,
	database: prismaAdapter(prisma, { provider: 'postgresql' }),
	plugins: [sveltekitCookies(getRequestEvent)]
});
