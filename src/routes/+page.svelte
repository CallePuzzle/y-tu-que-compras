<script lang="ts">
	import { resolve } from '$app/paths';
	import History from '@lucide/svelte/icons/history';
	import Languages from '@lucide/svelte/icons/languages';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Receipt from '@lucide/svelte/icons/receipt';
	import Refrigerator from '@lucide/svelte/icons/refrigerator';
	import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
	import Users from '@lucide/svelte/icons/users';
	import { m } from '$lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// El CTA depende de la sesión (el `user` lo trae el load del layout): sin
	// sesión manda a crear cuenta/acceder; con ella, a las listas (la portada
	// NO redirige: con sesión se ve la misma landing, issue #133).
	const ctaHref = $derived(data.user ? resolve('/lists') : resolve('/login'));

	// Pasos y funcionalidades en render: las etiquetas `m.*` se resuelven al
	// pintar, con la locale de la petición (igual que en `src/lib/routes.ts`).
	const pasos = [
		{ title: m.landing_step_family_title(), text: m.landing_step_family_text() },
		{ title: m.landing_step_invite_title(), text: m.landing_step_invite_text() },
		{ title: m.landing_step_items_title(), text: m.landing_step_items_text() },
		{ title: m.landing_step_finalize_title(), text: m.landing_step_finalize_text() }
	];

	const funcionalidades = [
		{
			icon: ListChecks,
			title: m.landing_feature_lists_title(),
			text: m.landing_feature_lists_text()
		},
		{
			icon: Users,
			title: m.landing_feature_family_title(),
			text: m.landing_feature_family_text()
		},
		{
			icon: Receipt,
			title: m.landing_feature_checkout_title(),
			text: m.landing_feature_checkout_text()
		},
		{
			icon: Refrigerator,
			title: m.landing_feature_pantry_title(),
			text: m.landing_feature_pantry_text()
		},
		{
			icon: History,
			title: m.landing_feature_history_title(),
			text: m.landing_feature_history_text()
		},
		{
			icon: Languages,
			title: m.landing_feature_i18n_title(),
			text: m.landing_feature_i18n_text()
		}
	];
</script>

<svelte:head>
	<title>{m.app_brand()}</title>
	<meta name="description" content={m.app_tagline()} />
</svelte:head>

<!-- Landing pública (issue #133): explica qué es la app a quien llega sin
     sesión (p. ej. desde una invitación). Sin imágenes ni mockups (no hay
     assets de screenshots): tipografía y iconos lucide, como el resto. -->
<section class="hero bg-base-200 rounded-box min-h-[50vh]">
	<div class="hero-content text-center">
		<div class="max-w-lg">
			<h1 class="text-5xl font-bold">{m.app_brand()}</h1>
			<p class="py-6">{m.app_tagline()}</p>
			<a href={ctaHref} class="btn btn-primary">
				<ShoppingBasket aria-hidden="true" />
				{data.user ? m.landing_cta_lists() : m.landing_cta_login()}
			</a>
		</div>
	</div>
</section>

<!-- Cómo funciona: la compra compartida en cuatro pasos, de crear la familia
     a llenar la despensa. Lista ordenada: los pasos van en secuencia. -->
<section class="mt-12">
	<h2 class="text-center text-2xl font-bold">{m.landing_how_title()}</h2>
	<ol class="mt-6 grid list-none gap-3 sm:grid-cols-2">
		{#each pasos as paso, indice (paso.title)}
			<li class="bg-base-200 rounded-box flex items-start gap-3 p-4">
				<span class="badge badge-primary shrink-0 font-bold" aria-hidden="true">
					{indice + 1}
				</span>
				<span class="min-w-0">
					<span class="block font-medium">{paso.title}</span>
					<span class="block text-sm opacity-70">{paso.text}</span>
				</span>
			</li>
		{/each}
	</ol>
</section>

<!-- Funcionalidades: lo que ya existe en la app, con su icono. -->
<section class="mt-12">
	<h2 class="text-center text-2xl font-bold">{m.landing_features_title()}</h2>
	<ul class="mt-6 grid list-none gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each funcionalidades as funcionalidad (funcionalidad.title)}
			{@const Icon = funcionalidad.icon}
			<li class="bg-base-200 rounded-box p-4">
				<Icon aria-hidden="true" class="text-primary size-6" />
				<h3 class="mt-2 font-medium">{funcionalidad.title}</h3>
				<p class="mt-1 text-sm opacity-70">{funcionalidad.text}</p>
			</li>
		{/each}
	</ul>
</section>

<!-- CTA final de cierre: mismo destino que el del hero. -->
<section class="hero bg-base-200 rounded-box mt-12">
	<div class="hero-content text-center">
		<div class="max-w-md">
			<h2 class="text-2xl font-bold">{m.landing_cta_title()}</h2>
			<p class="py-4 opacity-70">{m.landing_cta_text()}</p>
			<a href={ctaHref} class="btn btn-primary">
				<ShoppingBasket aria-hidden="true" />
				{data.user ? m.landing_cta_lists() : m.landing_cta_login()}
			</a>
		</div>
	</div>
</section>
