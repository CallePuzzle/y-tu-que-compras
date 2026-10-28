/**
 * Teclado de un grupo `role="radiogroup"` hecho con botones (issue #116),
 * patrón WAI-ARIA: el grupo es UNA sola parada de tabulador (roving tabindex:
 * `tabindex=0` solo en la opción marcada) y las flechas mueven la selección y
 * el foco — ←/↑ a la anterior, →/↓ a la siguiente, circular; Inicio y Fin a
 * los extremos.
 */

/** El índice al que lleva la tecla, o `null` si no es de navegación. */
export function radioTarget(key: string, index: number, length: number): number | null {
	switch (key) {
		case 'ArrowRight':
		case 'ArrowDown':
			return (index + 1) % length;
		case 'ArrowLeft':
		case 'ArrowUp':
			return (index - 1 + length) % length;
		case 'Home':
			return 0;
		case 'End':
			return length - 1;
		default:
			return null;
	}
}

/**
 * `onkeydown` del contenedor del grupo: elige la opción a la que lleva la
 * tecla y le pasa el foco. `values` va en el mismo orden que los `role="radio"`.
 */
export function onRadioGroupKeydown<T>(
	event: KeyboardEvent,
	values: readonly T[],
	current: T,
	select: (value: T) => void
): void {
	const destino = radioTarget(event.key, Math.max(values.indexOf(current), 0), values.length);
	if (destino === null) return;
	event.preventDefault();
	select(values[destino]);
	const radios = (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
		'[role="radio"]'
	);
	radios[destino]?.focus();
}
