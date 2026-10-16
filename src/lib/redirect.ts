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
