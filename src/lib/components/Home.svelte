<script lang="ts">
	import { resolve } from '$app/paths';
	import History from '@lucide/svelte/icons/history';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Refrigerator from '@lucide/svelte/icons/refrigerator';
	import Store from '@lucide/svelte/icons/store';
	import Tags from '@lucide/svelte/icons/tags';
	import Users from '@lucide/svelte/icons/users';
	import { m } from '#lib/paraglide/messages.js';
	import { TOUR_HOME_CTA_ID } from '#lib/utils/tour.js';

	interface Props {
		/** Usuario con sesión: la portada sólo monta el home con él (#160). */
		user: { name: string; email: string };
	}

	let { user }: Props = $props();

	// Nombre del saludo: el real si lo hay; si no, el email. El alta por OTP
	// crea usuarios con `name` vacío (mejor-auth lo deja en blanco), y el
	// fallback es el mismo que usa el avatar de `NavBarEnd` en svelte-ui.
	const nombreUsuario = $derived(user.name?.trim() || user.email);

	// Los accesos del home: todo lo que el menú de sesión ofrece, menos el
	// propio inicio. En orden de uso diario: navegar primero (listas,
	// despensa, historial) y gestión fina después (categorías,
	// establecimientos, familias). Etiquetas del mapa de rutas (`routes_*`),
	// igual que dock y menús, y una línea `home_*_text` que explica qué hay
	// detrás de cada acceso. En render: `setLocale` recarga la página, así que
	// resolver las etiquetas aquí (como en `Landing`) no se queda congelado.
	// El de listas lleva el ancla del paso 1 del tour de onboarding (#142),
	// que sobrevive al rediseño.
	const accesos = [
		{
			href: resolve('/lists'),
			icon: ListChecks,
			label: m.routes_lists(),
			text: m.home_lists_text(),
			tour: true
		},
		{
			href: resolve('/pantry'),
			icon: Refrigerator,
			label: m.routes_pantry(),
			text: m.home_pantry_text()
		},
		{
			href: resolve('/history'),
			icon: History,
			label: m.routes_history(),
			text: m.home_history_text()
		},
		{
			href: resolve('/categories'),
			icon: Tags,
			label: m.routes_categories(),
			text: m.home_categories_text()
		},
		{
			href: resolve('/stores'),
			icon: Store,
			label: m.routes_stores(),
			text: m.home_stores_text()
		},
		{
			href: resolve('/families'),
			icon: Users,
			label: m.routes_families(),
			text: m.home_families_text()
		}
	];
</script>

<!-- Home de la portada con sesión (issue #161): saludo y accesos con una
     línea de descripción cada uno (#164 y #177 añaden los suyos), a la
     espera del contenido definitivo que definirá producto. -->
<section class="mx-auto max-w-2xl">
	<h1 class="text-2xl font-bold">{m.home_greeting({ name: nombreUsuario })}</h1>

	<ul class="mt-6 grid list-none gap-3 sm:grid-cols-2">
		{#each accesos as acceso (acceso.href)}
			{@const Icon = acceso.icon}
			<li>
				<a
					href={acceso.href}
					id={acceso.tour ? TOUR_HOME_CTA_ID : undefined}
					class="bg-base-200 hover:bg-base-300 rounded-box flex items-start gap-3 p-4 transition-colors"
				>
					<Icon aria-hidden="true" class="text-primary mt-0.5 size-6 shrink-0" />
					<span class="min-w-0">
						<span class="block font-medium">{acceso.label}</span>
						<span class="block text-sm opacity-70">{acceso.text}</span>
					</span>
				</a>
			</li>
		{/each}
	</ul>
</section>
