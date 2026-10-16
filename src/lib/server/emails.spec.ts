import { afterEach, describe, expect, it } from 'vitest';

import { sendFamilyInvitationEmail, sendOtpEmail } from './emails.js';
import { capturedEmailsForTests, clearCapturedEmailsForTests } from './sender.js';

describe('plantillas de email', () => {
	afterEach(() => {
		clearCapturedEmailsForTests();
	});

	it('envia el codigo OTP en español, en el asunto y en el cuerpo', async () => {
		await sendOtpEmail({ to: 'usuario@example.com', otp: '123456', locale: 'es' });

		expect(capturedEmailsForTests()).toHaveLength(1);
		const email = capturedEmailsForTests()[0];
		expect(email.to).toBe('usuario@example.com');
		expect(email.subject).toContain('123456');
		expect(email.text).toContain('123456');
	});

	it('envia el codigo OTP en inglés, en el asunto y en el cuerpo', async () => {
		await sendOtpEmail({ to: 'user@example.com', otp: '654321', locale: 'en' });

		expect(capturedEmailsForTests()).toHaveLength(1);
		const email = capturedEmailsForTests()[0];
		expect(email.to).toBe('user@example.com');
		expect(email.subject).toContain('654321');
		expect(email.text).toContain('654321');
	});

	it('la plantilla OTP es distinta en cada idioma', async () => {
		await sendOtpEmail({ to: 'usuario@example.com', otp: '111111', locale: 'es' });
		await sendOtpEmail({ to: 'usuario@example.com', otp: '111111', locale: 'en' });

		const [es, en] = capturedEmailsForTests();
		expect(es.subject).not.toBe(en.subject);
		expect(es.text).not.toBe(en.text);
	});

	it('envia la invitacion a la familia en español', async () => {
		await sendFamilyInvitationEmail({
			to: 'invitado@example.com',
			inviter: 'César',
			url: 'https://y-tu-que-compras.example.com/invitacion/token',
			locale: 'es'
		});

		expect(capturedEmailsForTests()).toHaveLength(1);
		const email = capturedEmailsForTests()[0];
		expect(email.to).toBe('invitado@example.com');
		expect(email.subject).toContain('César');
		expect(email.text).toContain('César');
		expect(email.text).toContain('https://y-tu-que-compras.example.com/invitacion/token');
	});

	it('envia la invitacion a la familia en inglés', async () => {
		await sendFamilyInvitationEmail({
			to: 'guest@example.com',
			inviter: 'César',
			url: 'https://y-tu-que-compras.example.com/invitation/token',
			locale: 'en'
		});

		expect(capturedEmailsForTests()).toHaveLength(1);
		const email = capturedEmailsForTests()[0];
		expect(email.to).toBe('guest@example.com');
		expect(email.subject).toContain('César');
		expect(email.text).toContain('https://y-tu-que-compras.example.com/invitation/token');
	});

	it('la plantilla de invitacion es distinta en cada idioma', async () => {
		await sendFamilyInvitationEmail({
			to: 'invitado@example.com',
			inviter: 'César',
			url: 'https://example.com/token',
			locale: 'es'
		});
		await sendFamilyInvitationEmail({
			to: 'invitado@example.com',
			inviter: 'César',
			url: 'https://example.com/token',
			locale: 'en'
		});

		const [es, en] = capturedEmailsForTests();
		expect(es.subject).not.toBe(en.subject);
		expect(es.text).not.toBe(en.text);
	});
});
