<script lang="ts">
	import { tick, type Snippet } from 'svelte';

	/**
	 * Botón de menú desplegable (issue #116), patrón «menu button» de WAI-ARIA.
	 *
	 * daisyUI abre sus `dropdown` por `:focus-within`, pero WebKit (Safari/iOS)
	 * NO da foco a un `<button>` al pulsarlo: el menú podía no abrir en un
	 * iPhone. Aquí la apertura es estado explícito (el click del disparador),
	 * y la clase `dropdown-open` de daisyUI lo pinta, sin depender del foco.
	 *
	 * Teclado: el disparador abre con Enter/Espacio/↓ (y ↑, al último item);
	 * dentro, ↑/↓/Inicio/Fin mueven el foco entre los `menuitem` y Escape
	 * cierra devolviendo el foco al disparador. Se cierra también al pulsar
	 * fuera, al salir con Tab y cuando el consumidor llama a `close` (p. ej.
	 * al elegir un item).
	 */
	type Props = {
		/** Nombre accesible del disparador. */
		label: string;
		/** Clases del disparador (`btn btn-ghost`…). */
		triggerClass?: string;
		/** Clases de la lista (ancho, etc.). */
		menuClass?: string;
		class?: string;
		/** Contenido del disparador. */
		trigger: Snippet;
		/**
		 * Los items: `<li role="none"><button role="menuitem">…` (o
		 * `menuitemradio` con `aria-checked` en un selector). Recibe
		 * `close` para cerrar al elegir.
		 */
		items: Snippet<[{ close: () => void }]>;
	};

	let {
		label,
		triggerClass = '',
		menuClass = '',
		class: className,
		trigger,
		items
	}: Props = $props();

	const id = $props.id();
	let open = $state(false);
	let root: HTMLDivElement | undefined = $state();
	let triggerButton: HTMLButtonElement | undefined = $state();
	let menu: HTMLUListElement | undefined = $state();

	/** Los items enfocables (los deshabilitados se saltan). */
	function menuItems(): HTMLElement[] {
		return Array.from(
			menu?.querySelectorAll<HTMLElement>(
				':is([role="menuitem"], [role="menuitemradio"]):not([disabled])'
			) ?? []
		);
	}

	async function abrir(foco: 'first' | 'last' = 'first') {
		open = true;
		await tick();
		const lista = menuItems();
		(foco === 'first' ? lista[0] : lista.at(-1))?.focus();
	}

	function close() {
		open = false;
	}

	/** Cierra y devuelve el foco al disparador (Escape). */
	function cerrarAlDisparador() {
		close();
		triggerButton?.focus();
	}

	function onTriggerKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			void abrir(event.key === 'ArrowDown' ? 'first' : 'last');
		}
	}

	function onMenuKeydown(event: KeyboardEvent) {
		const lista = menuItems();
		const actual = lista.indexOf(document.activeElement as HTMLElement);
		let siguiente: number;
		switch (event.key) {
			case 'ArrowDown':
				siguiente = (actual + 1) % lista.length;
				break;
			case 'ArrowUp':
				siguiente = (actual - 1 + lista.length) % lista.length;
				break;
			case 'Home':
				siguiente = 0;
				break;
			case 'End':
				siguiente = lista.length - 1;
				break;
			case 'Escape':
				event.preventDefault();
				cerrarAlDisparador();
				return;
			default:
				return;
		}
		event.preventDefault();
		lista[siguiente]?.focus();
	}

	// Pulsar fuera cierra. `pointerdown` y no `click`: llega antes de que el
	// foco cambie y también con toques en iOS.
	$effect(() => {
		if (!open) return;
		function fuera(event: PointerEvent) {
			if (root && !root.contains(event.target as Node)) close();
		}
		document.addEventListener('pointerdown', fuera);
		return () => document.removeEventListener('pointerdown', fuera);
	});
</script>

<div
	bind:this={root}
	class="dropdown dropdown-end {open ? 'dropdown-open' : ''} {className ?? ''}"
	onfocusout={(event) => {
		// Salir con Tab (el foco se va fuera del componente) cierra.
		const destino = event.relatedTarget as Node | null;
		if (destino && root && !root.contains(destino)) close();
	}}
>
	<button
		bind:this={triggerButton}
		type="button"
		aria-label={label}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls={`${id}-menu`}
		class={triggerClass}
		onclick={() => (open ? close() : void abrir())}
		onkeydown={onTriggerKeydown}
	>
		{@render trigger()}
	</button>
	{#if open}
		<ul
			bind:this={menu}
			id={`${id}-menu`}
			role="menu"
			aria-label={label}
			tabindex="-1"
			class="dropdown-content menu rounded-box bg-base-100 z-1 mt-3 p-2 shadow {menuClass}"
			onkeydown={onMenuKeydown}
		>
			{@render items({ close })}
		</ul>
	{/if}
</div>
