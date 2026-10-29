import { createHmac, randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { prisma } from './db';
import { loadTestEnv } from './env';

import type { User } from '../../src/lib/generated/prisma/client';

// Nombre por defecto de la cookie de sesión de better-auth (cookiePrefix
// "better-auth" + "session_token"); la app no lo personaliza.
const SESSION_COOKIE_NAME = 'better-auth.session_token';

// better-auth firma la cookie de sesión: valor = `${token}.${firma}` con la
// firma = HMAC-SHA256 del token en base64 usando BETTER_AUTH_SECRET
// (ver signCookieValue en better-call/dist/crypto.mjs).
function signSessionToken(token: string): string {
	const signature = createHmac('sha256', loadTestEnv().BETTER_AUTH_SECRET)
		.update(token)
		.digest('base64');
	return `${token}.${signature}`;
}

// Inserta una sesión directamente en BD y fija la cookie firmada en el
// contexto del navegador: evita el flujo OTP (más lento) en todos los tests
// salvo los del propio login.
export async function seedSession(page: Page, user: User): Promise<void> {
	const token = randomUUID();
	const now = new Date();
	await prisma.session.create({
		data: {
			id: randomUUID(),
			token,
			userId: user.id,
			expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
			createdAt: now,
			updatedAt: now
		}
	});

	await page.context().addCookies([
		{
			name: SESSION_COOKIE_NAME,
			value: signSessionToken(token),
			url: loadTestEnv().BETTER_AUTH_URL
		}
	]);
}

// Espera a que el JS de SvelteKit haya cargado e hidratado la página: sin
// esto, un click inmediato tras goto() puede caer antes de que los
// manejadores estén registrados y no hacer nada.
export async function waitForHydration(page: Page): Promise<void> {
	await page.waitForLoadState('networkidle');
}

// Lee el OTP de la tabla verification con polling (hasta 10 s): en dev no hay
// SMTP y el código queda almacenado por el plugin email-otp con el identifier
// «sign-in-otp-<email>» y el valor «<otp>:<intentos>» (storeOTP «plain»).
export async function readOtp(email: string): Promise<string> {
	const identifier = `sign-in-otp-${email}`;
	const deadline = Date.now() + 10_000;

	while (Date.now() < deadline) {
		const verification = await prisma.verification.findFirst({
			where: { identifier },
			orderBy: { createdAt: 'desc' }
		});
		const otp = verification?.value.split(':')[0];
		if (otp) return otp;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	throw new Error(`No se encontró el OTP de ${email} en la tabla verification`);
}

/**
 * Flujo de login real por UI: pide el código con el email y lo canjea leyendo
 * el OTP de la BD. `startPath` es la página que se quería visitar: el guard
 * manda a `/login?redirectTo=…` y tras el canje la app vuelve a ella (con
 * `/invitations/...` además lleva el email prefijado). Debe ser una ruta
 * privada y sin requisito de familia activa (`/families` vale, `/lists` no:
 * sin familia elegida la vista manda a `/families`, issue #63). La portada
 * `/` también queda descartada: es la landing pública y no lleva al login
 * (#133).
 */
export async function loginViaUi(
	page: Page,
	email: string,
	startPath = '/families'
): Promise<void> {
	await page.goto(startPath);
	await waitForHydration(page);

	// Paso 1: pedir el código.
	await page.locator('input[name="email"]').fill(email);
	await page.getByRole('button', { name: 'Iniciar sesión' }).click();

	// Paso 2: el único input de la página es el del PinInput.
	const otpInput = page.locator('input[autocomplete="one-time-code"]');
	await otpInput.waitFor();
	const otp = await readOtp(email);
	await otpInput.pressSequentially(otp);

	// El sign-in va por fetch y el éxito navega de vuelta a `startPath`
	// (`onLoginSuccess` del +page.svelte de /login): sin esta espera, un goto
	// inmediato abortaría la petición y la cookie no quedaría fijada.
	await page.waitForURL((url) => url.pathname === startPath);
}
