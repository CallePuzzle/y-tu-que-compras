<script lang="ts">
	import { resolve } from '$app/paths';
	import History from '@lucide/svelte/icons/history';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import { m } from '$lib/paraglide/messages.js';
	import { TOUR_HOME_CTA_ID } from '$lib/utils/tour.js';

	interface Props {
		/** Usuario con sesión: la portada sólo monta el home con él (#160). */
		user: { name: string; email: string };
	}

	let { user }: Props = $props();

	// Nombre del saludo: el real si lo hay; si no, el email. El alta por OTP
	// crea usuarios con `name` vacío (mejor-auth lo deja en blanco), y el
	// fallback es el mismo que usa el avatar de `NavBarEnd` en svelte-ui.
	const nombreUsuario = $derived(user.name?.trim() || user.email);
</script>

<!-- Home de la portada con sesión (issue #161): saludo y accesos rápidos, a la
     espera del contenido definitivo que definirá producto. Las etiquetas de
     los accesos son las del mapa de rutas (`routes_*`), igual que dock y
     menús; el de listas lleva el ancla del paso 1 del tour de onboarding
     (#142), que sobrevive al rediseño. Los accesos a categorías y
     establecimientos llegarán con sus épicas (#164 y #177): hasta entonces
     este home no los muestra. -->
<section class="mx-auto max-w-md">
	<h1 class="text-2xl font-bold">{m.home_greeting({ name: nombreUsuario })}</h1>

	<ul class="mt-6 grid list-none gap-3 sm:grid-cols-2">
		<li>
			<a
				href={resolve('/lists')}
				id={TOUR_HOME_CTA_ID}
				class="bg-base-200 hover:bg-base-300 rounded-box flex items-center gap-3 p-4 font-medium transition-colors"
			>
				<ListChecks aria-hidden="true" class="text-primary size-6 shrink-0" />
				{m.routes_lists()}
			</a>
		</li>
		<li>
			<a
				href={resolve('/history')}
				class="bg-base-200 hover:bg-base-300 rounded-box flex items-center gap-3 p-4 font-medium transition-colors"
			>
				<History aria-hidden="true" class="text-primary size-6 shrink-0" />
				{m.routes_history()}
			</a>
		</li>
	</ul>
</section>
