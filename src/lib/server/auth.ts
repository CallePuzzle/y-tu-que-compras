import prisma from '$lib/server/prisma';
import { emailOtpRateLimitRules, getBetterAuth } from '@callepuzzle/auth/server';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { dev } from '$app/environment';
import { getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';

// better-auth no ve el .env vía process.env en este setup (bun no lo inyecta en
// los scripts de package.json), así que baseURL y secret van explícitos desde
// `$env/dynamic/private`: el handle de @callepuzzle/auth corta el arranque si
// faltan. El acceso a `prisma` es perezoso: durante `vite build` no se abre
// ninguna conexión.
export const auth = getBetterAuth({
	baseURL: env.BETTER_AUTH_URL,
	secret: env.BETTER_AUTH_SECRET,
	database: prismaAdapter(prisma, { provider: 'postgresql' }),
	plugins: [sveltekitCookies(getRequestEvent)],

	// En Vercel cada invocación puede ser una instancia distinta: el almacén en
	// memoria por defecto no limita nada. `database` usa el modelo `RateLimit`.
	// Las reglas de OTP se adelantan para que estén puestas cuando entre el plugin.
	rateLimit: {
		enabled: !dev,
		storage: 'database',
		customRules: emailOtpRateLimitRules()
	},

	advanced: {
		// Vercel sobrescribe `x-real-ip` con la IP real del cliente; `x-forwarded-for`
		// (la cabecera por defecto) la puede falsear el cliente en otros entornos.
		ipAddress: { ipAddressHeaders: ['x-real-ip'] },
		// No depender del protocolo de BETTER_AUTH_URL: un `http://` mal puesto en
		// producción emitiría las cookies de sesión sin `Secure`.
		useSecureCookies: !dev
	},

	// Cifra access/refresh/id tokens de proveedores OAuth en la tabla `account`.
	account: { encryptOAuthTokens: true }
});
