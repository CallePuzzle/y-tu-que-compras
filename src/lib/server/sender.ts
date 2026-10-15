import nodemailer from 'nodemailer';

import type { Transporter } from 'nodemailer';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

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
	const host = env.SMTP_HOST;
	const user = env.SMPT_AUTH_USER;
	const pass = env.SMPT_AUTH_PASS;
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
		console.info(`[sender] email (capturado, no enviado):\n${JSON.stringify(content, null, 2)}`);
		capturedEmails.push(content);
		return;
	}

	// `$env/dynamic/private` y no `$env/static/private`: durante `vite build`
	// las variables no existen y el import estatico romperia la compilacion
	// (misma razon que en prisma.ts y auth.ts).
	const transporter = smtpTransporter();
	const from = env.SMPT_SENDER;
	if (!transporter || !from) {
		throw new Error('Falta la configuracion de envio de email. Ver .env.example.');
	}
	await transporter.sendMail({ ...content, from });
}
