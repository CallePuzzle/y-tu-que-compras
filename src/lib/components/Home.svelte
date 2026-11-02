<script lang="ts">
	import { resolve } from '$app/paths';
	import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
	import { m } from '$lib/paraglide/messages.js';
	import logo from '$lib/assets/logo.webp';
	import { TOUR_HOME_CTA_ID } from '$lib/utils/tour.js';
</script>

<!-- Home de la portada con sesión (issue #160): placeholder mínimo a la espera
     de la estructura definitiva (#161, saludo y accesos). El CTA a las listas
     no es opcional: el paso 1 del tour de onboarding (#142) se ancla en él
     (`TOUR_HOME_CTA_ID`), y con sesión la portada ya no pinta la landing. -->
<section class="hero bg-base-200 rounded-box min-h-[50vh]">
	<div class="hero-content text-center">
		<div class="max-w-lg">
			<!-- El logo es decorativo (`alt=""`): la marca ya está en el `h1`.
			     `object-contain`: el asset NO es cuadrado (195×189) y la caja
			     (`size-24`) sí; sin él el navegador lo aplasta (Lighthouse
			     `image-aspect-ratio`). -->
			<img src={logo} alt="" class="mx-auto mb-4 size-24 object-contain" />
			<h1 class="text-5xl font-bold">{m.app_brand()}</h1>
			<p class="py-6">{m.app_tagline()}</p>
			<!-- Texto prestado de la landing (`landing_cta_lists`): las claves
			     propias del home llegan con #161. -->
			<a href={resolve('/lists')} id={TOUR_HOME_CTA_ID} class="btn btn-primary">
				<ShoppingBasket aria-hidden="true" />
				{m.landing_cta_lists()}
			</a>
		</div>
	</div>
</section>
