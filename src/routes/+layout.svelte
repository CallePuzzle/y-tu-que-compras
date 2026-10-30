<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import {
		ButtonSignOut,
		Dock,
		Drawer,
		Footer,
		Header,
		Link,
		NavBarEnd,
		NavBarList,
		UserNotLogged
	} from '@callepuzzle/svelte-ui';
	import { invalidateAll } from '$app/navigation';
	import { getRoutes } from '$lib/routes';
	import { m } from '$lib/paraglide/messages.js';
	import { authClient } from '$lib/auth-client.js';
	import FamilySwitcher from '$lib/components/FamilySwitcher.svelte';
	import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';
	import logo from '$lib/assets/logo.webp';
	import type { LayoutProps } from './$types';

	// `children` se renombra: dentro del snippet `children` del `Drawer` el nombre
	// quedaría sombreado y `{@render children()}` fallaría.
	let { children: content, data }: LayoutProps = $props();

	// `getRoutes()` es una factoría para que las etiquetas se resuelvan al renderizar,
	// con el locale de la petición. `$derived` (y no una llamada única): el layout no
	// se remonta al navegar, y el mapa debe recalcularse cuando `data.user` aparece
	// o desaparece (tras el login/logout), p. ej. para ocultar «Acceder» de los menús.
	const routes = $derived(getRoutes(Boolean(data.user)));

	// El login es público: su contenido no exige sesión. La vista de una
	// invitación por token también (issue #61): el token del enlace es la
	// credencial y quien llega sin cuenta debe poder LEER su estado («no es
	// válida», «caducada», «aceptada»…), igual que lo permite el guard de
	// hooks (`isPublicPathname`). La portada también (issue #133): es la
	// landing pública, que explica la app a quien llega sin sesión (con
	// sesión se ve la misma). En el resto de rutas, si no hay usuario se
	// muestra el aviso (defensiva: el guard de hooks ya redirige a /login;
	// esto cubre p. ej. una sesión que muere entre navegaciones).
	const showContent = $derived(
		Boolean(data.user) ||
			page.route.id === '/login' ||
			page.route.id === '/invitations/[token]' ||
			page.route.id === '/'
	);

	// Tras `signOut()` la cookie ya no vale, pero SvelteKit NO reejecuta el load
	// del layout al navegar (no depende de url/params): sin esta invalidación la
	// cabecera seguiría pintando al usuario. El refetch pasa por el guard y, al
	// no haber sesión, nos termina mandando a /login.
	async function onSignOut() {
		await invalidateAll();
	}
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
					<!-- El logo es decorativo (`alt=""`): la marca ya es texto y el
					     conjunto va dentro del `Link` a la portada que pone `Header`. -->
					<span class="flex items-center gap-2">
						<img src={logo} alt="" class="size-8 rounded-full" />
						<span class="text-lg font-bold">{m.app_brand()}</span>
					</span>
				{/snippet}

				{#snippet navEnd()}
					<!-- Con sesión, el menú de usuario con «Cerrar sesión». Sin sesión, un
					     enlace al login. El `ButtonSignOut` va en `menuExtra` (y no vía la
					     prop `authClient`) porque `NavBarEnd` no reenvía `onSignOut`, y el
					     logout necesita invalidar los datos: sin eso la cabecera seguiría
					     pintando la sesión vieja. `redirectTo={null}`: la navegación la
					     decide el guard, que con la cookie borrada manda a /login.
					     La caja `navbar-end` la pone el contenedor: `NavBarEnd` pierde su
					     `width: 50%` con `w-auto` (las utilidades van en una capa posterior
					     a los componentes de daisyUI), y así el selector de familia y el
					     avatar quedan juntos en el borde derecho. -->
					<div class="navbar-end gap-1">
						<!-- El idioma se cambia sin sesión (la portada y el login son
						     bilingües) y en móvil vive en la misma navbar. -->
						<LanguageSwitcher />
						{#if data.user}
							<FamilySwitcher activeFamily={data.activeFamily} families={data.families} />
						{/if}
						<NavBarEnd
							class="w-auto"
							user={data.user}
							strings={{
								userMenu: m.ui_user_menu(),
								signOut: m.ui_sign_out(),
								avatarAlt: (name) => m.ui_avatar_alt({ name })
							}}
						>
							{#snippet login()}
								<Link href="/login" label={m.routes_login()} class="btn btn-primary" />
							{/snippet}

							<!-- Marcado de menú (issue #116, svelte-ui 1.1.0): `NavBarEnd`
							     sigue el patrón «menu button», así que sus entradas van en un
							     `<li role="none">` con `role="menuitem"`. -->
							{#snippet menuExtra()}
								<li role="none">
									<ButtonSignOut
										{authClient}
										redirectTo={null}
										{onSignOut}
										role="menuitem"
										strings={{ signOut: m.ui_sign_out() }}
									/>
								</li>
							{/snippet}
						</NavBarEnd>
					</div>
				{/snippet}
			</Header>

			<main class="container mx-auto grow p-4 pb-24 lg:pb-4">
				<!-- Ver `showContent`: sin sesión (fuera de /login) se muestra el aviso. -->
				{#if showContent}
					{@render content()}
				{:else}
					<UserNotLogged text={m.ui_user_not_logged()}>
						{#snippet action()}
							<Link href="/login" label={m.routes_login()} class="btn btn-primary" />
						{/snippet}
					</UserNotLogged>
				{/if}
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
		<!-- El panel lo envuelve la app (fondo incluido) para alojar el selector
		     de familia encima de la navegación: `NavBarList` ya traía `w-80` y
		     `bg-base-200` para el drawer, y el mismo fondo en el contenedor hace
		     que el bloque del selector no se note como un parche. -->
		<div class="bg-base-200 min-h-full w-80">
			{#if data.user}
				<div class="px-4 pt-4">
					<!-- Con sesión, el selector de familia activa (#64). En el drawer
					     hay sitio: variante de ancho completo, con el nombre visible. -->
					<FamilySwitcher activeFamily={data.activeFamily} families={data.families} fullWidth />
				</div>
			{/if}
			<nav aria-label={m.ui_side_nav()}>
				<NavBarList type="drawer" {routes} />
			</nav>
		</div>
	{/snippet}
</Drawer>
