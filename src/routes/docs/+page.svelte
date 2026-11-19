<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { m } from '#lib/paraglide/messages.js';

	// /docs (US6 #266, tarea #281): referencia de la API con Scalar, leyendo
	// GET /api/v1/openapi.json. Pública (`isPublicPathname`). Scalar sale del
	// paquete npm (no del CDN, por la CSP) y se importa en `onMount`: solo lo
	// descarga quien abre /docs y nunca entra en SSR.
	const SPEC_URL = '/api/v1/openapi.json';

	let container: HTMLDivElement;
	let status = $state<'loading' | 'ready' | 'error'>('loading');

	onMount(() => {
		let app: { destroy: () => void } | undefined;
		let cancelled = false;

		(async () => {
			try {
				const [{ createApiReference }] = await Promise.all([
					import('@scalar/api-reference'),
					import('@scalar/api-reference/style.css')
				]);
				if (cancelled) return;
				app = createApiReference(container, {
					url: SPEC_URL,
					// La app solo tiene tema oscuro.
					forceDarkModeState: 'dark',
					hideDarkModeToggle: true,
					// Nada de terceros (fuentes, telemetría, agente, cliente externo).
					withDefaultFonts: false,
					telemetry: false,
					agent: { disabled: true },
					hideClientButton: true,
					showDeveloperTools: 'never'
				});
				status = 'ready';
			} catch (error) {
				console.error('No se pudo cargar Scalar', error);
				status = 'error';
			}
		})();

		return () => {
			cancelled = true;
			app?.destroy();
		};
	});
</script>

<svelte:head>
	<title>{m.docs_title()} · {m.app_brand()}</title>
	<meta name="description" content={m.docs_meta_description()} />
</svelte:head>

<h1 class="sr-only">{m.docs_title()}</h1>

{#if status === 'loading'}
	<p class="flex items-center justify-center gap-2 py-16 opacity-70" role="status">
		<span class="loading loading-spinner" aria-hidden="true"></span>
		{m.docs_loading()}
	</p>
{:else if status === 'error'}
	<div class="alert alert-error mx-auto max-w-md" role="alert">
		<p>
			{m.docs_load_error()}
			<a class="link" href={resolve(SPEC_URL)}>{m.docs_spec_link()}</a>
		</p>
	</div>
{/if}

<!-- El contenedor donde monta Scalar. `data-spec-url` deja visible qué spec
     renderiza (lo comprueba el e2e). -->
<div
	bind:this={container}
	class="docs-scalar"
	data-testid="api-reference"
	data-spec-url={SPEC_URL}
></div>

<style>
	/* Los colores de Scalar sobre el fondo de la app, para que no se note un
	   parche entre el layout y la referencia. */
	.docs-scalar :global(.dark-mode) {
		--scalar-background-1: var(--color-base-100);
		--scalar-background-2: var(--color-base-200);
		--scalar-background-3: var(--color-base-300);
		--scalar-color-1: var(--color-base-content);
	}
</style>
