/** Une el formato de error de superforms (string o lista) a texto plano. */
export function textoError(error: string | string[] | undefined): string | undefined {
	if (!error) return undefined;
	return Array.isArray(error) ? error.join(' ') : error;
}
