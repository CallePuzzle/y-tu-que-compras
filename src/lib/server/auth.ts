import prisma from '$lib/server/prisma';
import { emailOtpPreset, emailOtpRateLimitRules, getBetterAuth } from '@callepuzzle/auth/server';
import type { SendVerificationOtp } from '@callepuzzle/auth/server';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { dev } from '$app/environment';
import { getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';

import logger from '$lib/server/logger';
import { sendOtpEmail } from '$lib/server/emails';
import { tenancyConfig } from '$lib/server/tenancy.js';
import { tenancy } from '@zytera/better-auth-tenancy/server';

// El login solo usa OTP de tipo "sign-in": el resto de tipos no debería llegar
// nunca y no envía ningún correo.
const sendVerificationOtp: SendVerificationOtp = async ({ email, otp, type }) => {
	if (type !== 'sign-in') {
		logger.error({ otpType: type }, 'Tipo de OTP no soportado');
		return;
	}

	await sendOtpEmail({ to: email, otp });
};

// better-auth no ve el .env vía process.env en este setup (bun no lo inyecta en
// los scripts de package.json), así que baseURL y secret van explícitos desde
// `$env/dynamic/private`: el handle de @callepuzzle/auth corta el arranque si
// faltan. El acceso a `prisma` es perezoso: durante `vite build` no se abre
// ninguna conexión.
export const auth = getBetterAuth({
	baseURL: env.BETTER_AUTH_URL,
	secret: env.BETTER_AUTH_SECRET,
	database: prismaAdapter(prisma, { provider: 'postgresql' }),

	// En Vercel cada invocación puede ser una instancia distinta: el almacén en
	// memoria por defecto no limita nada. `database` usa el modelo `RateLimit`.
	// Cooldown del reenvío: 3 códigos por minuto por IP en los dos endpoints del
	// flujo OTP (pedir y canjear). Tras el límite better-auth responde 429, que
	// FormLoginOtp enseña como "espera unos segundos".
	rateLimit: {
		enabled: !dev,
		storage: 'database',
		customRules: emailOtpRateLimitRules()
	},

	plugins: [
		// Límite de intentos y caducidad del código: 3 intentos y 5 minutos
		// (defaults de better-auth, dejados explícitos para que el límite sea
		// visible; al agotarse el código queda invalidado).
		emailOtpPreset(sendVerificationOtp, { expiresIn: 300, allowedAttempts: 3 }),
		// Familias (familia = organization): endpoints de organizaciones, roles,
		// miembros e invitaciones. La configuración (i18n `es`, filtro de
		// familias por pertenencia y seed de roles al crear) vive en
		// `$lib/server/tenancy.ts`.
		tenancy(tenancyConfig),
		// sveltekitCookies el ÚLTIMO: better-auth avisa de que su hook `after`
		// debe correr al final o las Set-Cookie del login no llegan al navegador.
		sveltekitCookies(getRequestEvent)
	],

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
