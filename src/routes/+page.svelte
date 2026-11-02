<script lang="ts">
	import { page } from '$app/state';
	import Home from '#lib/components/Home.svelte';
	import Landing from '#lib/components/Landing.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { continueOnboardingTour } from '#lib/utils/tour.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Tour de onboarding (#142): con sesión, la primera visita a la portada lo
	// arranca y las navegaciones del propio tour retoman aquí el paso guardado.
	// Sin usuario no hace nada (no hay tour de invitado). Vive en la portada y
	// no en `Home`: es cosa de la ruta, que bifurca por sesión (#160).
	$effect(() => {
		void continueOnboardingTour(page.url.pathname, data.user ?? null);
	});
</script>

<svelte:head>
	<title>{m.app_brand()}</title>
	<meta name="description" content={m.app_tagline()} />
</svelte:head>

<!-- Portada bifurcada por sesión (issue #160), SIN redirects: `/` sigue siendo
     pública (ver `isPublicPathname` en `src/lib/server/auth-guard.ts`) y es la
     página la que decide qué pinta según traiga `user` el load del layout.
     Sin sesión, la landing (#133); con ella, el home. -->
{#if data.user}
	<Home user={data.user} />
{:else}
	<Landing />
{/if}
