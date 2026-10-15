<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { Dock, Drawer, Footer, Header, NavBarList } from '@callepuzzle/svelte-ui';
	import { getRoutes } from '$lib/routes';
	import { m } from '#lib/paraglide/messages.js';
	import type { LayoutProps } from './$types';

	// `children` se renombra: dentro del snippet `children` del `Drawer` el nombre
	// quedaría sombreado y `{@render children()}` fallaría.
	let { children: content }: LayoutProps = $props();

	// Factoría, no `const`: las etiquetas se resuelven en render con el locale activo.
	const routes = $derived(getRoutes());
</script>

<Drawer strings={{ openSidebar: m.ui_open_sidebar(), closeSidebar: m.ui_close_sidebar() }}>
	{#snippet children({ drawerId })}
		<div class="flex min-h-screen flex-col">
			<Header
				{routes}
				homeHref="/"
				menuToggleFor={drawerId}
				strings={{
					back: m.ui_back(),
					openSidebar: m.ui_open_sidebar(),
					navLabel: m.ui_main_nav()
				}}
			>
				{#snippet title()}
					<span class="text-lg font-bold">{m.app_brand()}</span>
				{/snippet}
			</Header>

			<main class="container mx-auto grow p-4 pb-24 lg:pb-4">
				{@render content()}
			</main>

			<Footer>
				<p class="p-4 text-sm opacity-70">{m.app_footer()}</p>
			</Footer>

			<!-- El dock sólo pinta las rutas con `showInMobile`; `currentPath` se compara
			     con la clave del `RouteMap`, así que `page.route.id` es la fuente correcta. -->
			<Dock
				{routes}
				currentPath={page.route.id ?? page.url.pathname}
				strings={{ navLabel: m.ui_bottom_nav() }}
			/>
		</div>
	{/snippet}

	{#snippet side()}
		<nav aria-label={m.ui_side_nav()}>
			<NavBarList type="drawer" {routes} />
		</nav>
	{/snippet}
</Drawer>
