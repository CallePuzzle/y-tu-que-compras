/**
 * Validación de URLs de retorno (`redirectTo`) contra *open redirects*.
 *
 * La regla: sólo rutas relativas al origen. Empieza por `/` pero **no** por `//`
 * ni `/\` (protocol-relative: el navegador las resuelve contra otro dominio), y
 * sin caracteres de control que un header `Location` o un `goto` podrían
 * reinterpretar. Sirve igual en servidor (guard) que en cliente (post-login).
 */

/** ¿Es una ruta interna segura? `null`/`undefined`/vacío no lo es. */
export function isInternalPath(value: string | null | undefined): value is string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
		return false;
	}
	// eslint-disable-next-line no-control-regex
	return !/[\u0000-\u001f\u007f]/.test(value);
}

/** La ruta si es interna; `undefined` si no, para caer a un destino por defecto. */
export function sanitizeRedirectTo(value: string | null | undefined): string | undefined {
	return isInternalPath(value) ? value : undefined;
}

/**
 * El email al que pre-rellenar el formulario de login (`?email=`, issue #61).
 *
 * Viaja en la query de una URL pública, así que es entrada de usuario: solo se
 * acepta si tiene forma de email (lo que el login pide de todos modos); lo que
 * no, se ignora y el campo queda vacío. Nunca decide nada de seguridad: solo
 * ahorra teclear la dirección a quien viene del enlace de invitación.
 */
export function sanitizeInvitedEmail(value: string | null | undefined): string | undefined {
	if (!value) return undefined;
	// Suficiente para el prefill (no para validar identidad): algo@algo.tld,
	// sin espacios ni controles. La validación real la hace el schema del form.
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : undefined;
}
