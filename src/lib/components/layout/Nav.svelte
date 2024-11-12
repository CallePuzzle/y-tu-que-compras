<script lang="ts">
	import { Routes } from '$lib/routes';
	import { Icon } from 'svelte-icons-pack';
	import { BiMenu } from 'svelte-icons-pack/bi';
	import Logo from '$lib/assets/logo.webp';

	const { userIsLogged = false, userPicture = '', notificationsCount = 0 } = $props();
</script>

<div class="navbar bg-base-100">
	<div class="flex-1">
		<a href={Routes.home.url} data-sveltekit-reload> <img src={Logo} alt="Icono cabecera" class="max-w-14" /> </a>
	</div>
	<div class="flex gap-2">
		<div class="name">
			<a href={Routes.home.url} class="btn btn-ghost text-xl flex" data-sveltekit-reload>
				<span>¿Y tú qué compras?</span>
			</a>
		</div>
		{#if userIsLogged}
			<div tabindex="0" role="button" class="btn btn-ghost btn-circle avatar indicator">
				{#if notificationsCount}
					<span class="indicator-item badge badge-warning">
						{notificationsCount}
					</span>
				{/if}
				<div class="w-10 rounded-full">
					<a href={Routes.profile.url} aria-label="Go to profile"
						><img alt="Profile" src={userPicture} /></a
					>
				</div>
			</div>
		{:else}
			<ul class="menu menu-horizontal px-1">
				<li><a href={Routes.login.url}>Login</a></li>
			</ul>
		{/if}
	</div>
</div>
