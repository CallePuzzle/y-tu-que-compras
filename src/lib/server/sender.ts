import nodemailer from 'nodemailer';

import type { Transporter } from 'nodemailer';
import { dev } from '$app/env';
import { SMTP_HOST, SMPT_AUTH_USER, SMPT_AUTH_PASS, SMPT_SENDER } from '$app/env/private';

import logger from '#lib/server/logger.js';

export interface EmailContent {
	to: string;
	subject: string;
	text: string;
}

// Emails capturados en desarrollo/test: `sendEmail` nunca abre conexion, deja
// aqui el mensaje para inspeccionarlo (y desde los tests, asertarlo).
const capturedEmails: EmailContent[] = [];

export function capturedEmailsForTests(): readonly EmailContent[] {
	return capturedEmails;
}

export function clearCapturedEmailsForTests(): void {
	capturedEmails.length = 0;
}

// Cacheado a nivel de modulo: las opciones vienen siempre de las mismas env
// vars, asi que reutilizamos la misma conexion/pool en vez de crear una por
// email enviado.
let transporter: Transporter | undefined;

function smtpTransporter(): Transporter | undefined {
	const host = SMTP_HOST;
	const user = SMPT_AUTH_USER;
	const pass = SMPT_AUTH_PASS;
	if (!host || !user || !pass) {
		return undefined;
	}
	transporter ??= nodemailer.createTransport({
		host,
		port: 587,
		secure: false,
		auth: { user, pass }
	});
	return transporter;
}

export async function sendEmail(content: EmailContent): Promise<void> {
	if (dev) {
		// Transporte de desarrollo/test: de local no sale ningun email real.
		// Via pino (como el resto de logs de la app); las claves del contenido
		// (`to`, `subject`, `text`) no colisionan con las redactadas.
		logger.info(content, 'email capturado (no enviado)');
		capturedEmails.push(content);
		return;
	}

	// `$app/env/private` y no `$env/static/private`: durante `vite build`
	// las variables no existen y el import estatico romperia la compilacion
	// (misma razon que en prisma.ts y auth.ts).
	const transporter = smtpTransporter();
	const from = SMPT_SENDER;
	if (!transporter || !from) {
		throw new Error('Falta la configuracion de envio de email. Ver .env.example.');
	}
	await transporter.sendMail({ ...content, from });
}
