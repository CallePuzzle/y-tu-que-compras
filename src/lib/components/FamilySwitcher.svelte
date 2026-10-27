<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Users from '@lucide/svelte/icons/users';
	import { Link } from '@callepuzzle/svelte-ui';
	import { m } from '$lib/paraglide/messages.js';

	// Selector de familia activa (issue #64). Se renderiza en la cabecera y en
	// el drawer del layout con las familias que el load del layout trae del
	// servidor (ya verificadas en la tabla `member`). El estado lo cambia el
	// endpoint `POST /families/active`, que verifica membresía y fija la cookie
	// httpOnly: aquí sólo queda refrescar todos los datos con `invalidateAll`,
	// y cada vista vuelve a pedir los suyos ya contra la familia nueva.
	interface Props {
		/** Familia activa; `null` con varias familias y ninguna elegida todavía. */
		activeFamily?: { id: string; name: string } | null;
		/** Familias del usuario. */
		families?: Array<{ id: string; name: string }>;
		/** Botón compacto de navbar (por defecto) o ancho completo, para el drawer. */
		fullWidth?: boolean;
		class?: string;
	}

	let { activeFamily = null, families = [], fullWidth = false, class: className }: Props = $props();

	// Sólo para `aria-expanded`: daisyUI muestra el dropdown por CSS con
	// `:focus-within`, igual que hace `NavBarEnd` en la librería.
	let open = $state(false);

	/** Id de la familia en curso de cambio, para el spinner del item pulsado. */
	let switchingId = $state<string | null>(null);
	let failed = $state(false);

	async function switchTo(familyId: string): Promise<void> {
		switchingId = familyId;
		failed = false;
		try {
			const body = new FormData();
			body.set('familyId', familyId);
			const response = await fetch(resolve('/families/active'), { method: 'POST', body });
			// `redirected`: si la sesión murió a medias, el guard habría mandado
			// el POST al login; ese HTML con 200 no es un éxito.
			if (!response.ok || response.redirected) {
				failed = true;
				return;
			}
			// La cookie ya apunta a la nueva familia: reejecutar TODOS los loads
			// (el del layout también) repinta cada vista con el contexto nuevo.
			await invalidateAll();
		} catch {
			failed = true;
		} finally {
			switchingId = null;
		}
	}
</script>

{#if families.length === 0}
	<!-- Cero familias: no hay nada que seleccionar. El CTA manda a /families,
	     donde está el formulario de creación. -->
	<Link
		href="/families"
		label={m.families_create()}
		class="btn btn-primary {fullWidth ? 'w-full' : ''}"
	/>
{:else}
	<div
		class="dropdown dropdown-end {fullWidth ? 'w-full' : ''} {className ?? ''}"
		onfocusin={() => (open = true)}
		onfocusout={() => (open = false)}
	>
		<button
			type="button"
			aria-label={m.families_switch_label()}
			aria-haspopup="menu"
			aria-expanded={open}
			class="btn btn-ghost {fullWidth ? 'w-full' : ''}"
		>
			<Users />
			{#if fullWidth}
				<!-- En el drawer el nombre sobresale: hay sitio de sobra. -->
				<span class="min-w-0 flex-1 truncate text-left">
					{activeFamily?.name ?? m.families_switch_pick()}
				</span>
				<ChevronDown />
			{:else}
				<!-- En la navbar, el nombre sólo cuando cabe (a partir de `sm`):
				     en móvil el icono solo, que ahí manda el espacio. -->
				<span class="hidden max-w-40 min-w-0 items-center gap-1 sm:inline-flex">
					<span class="truncate">{activeFamily?.name ?? m.families_switch_pick()}</span>
					<ChevronDown />
				</span>
			{/if}
		</button>
		<ul
			class="dropdown-content menu rounded-box bg-base-100 z-1 mt-3 p-2 shadow {fullWidth
				? 'w-full'
				: 'w-56'}"
		>
			{#each families as family (family.id)}
				<li>
					<button type="button" disabled={switchingId !== null} onclick={() => switchTo(family.id)}>
						{#if switchingId === family.id}
							<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
						{:else if family.id === activeFamily?.id}
							<Check aria-hidden="true" />
						{/if}
						<span class="truncate">{family.name}</span>
					</button>
				</li>
			{/each}
			{#if failed}
				<!-- Fuera del flujo normal: sólo informativo, no clicable. -->
				<li class="pointer-events-none">
					<span class="text-error">{m.families_switch_error()}</span>
				</li>
			{/if}
		</ul>
	</div>
{/if}
