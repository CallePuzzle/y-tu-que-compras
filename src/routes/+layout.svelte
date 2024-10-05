<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import Nav from '$lib/components/layout/Nav.svelte';
	import toast, { Toaster } from 'svelte-french-toast';
	import { SubscribeUser } from '$lib/notification/subscribe-user';
	import { Routes } from '$lib/routes';

	let { children, data } = $props();

	onMount(async () => {
		await Notification.requestPermission();
		if ('serviceWorker' in navigator && data.userIsLogged) {
			const reg = await navigator.serviceWorker.ready;
			await SubscribeUser(data.userIsLogged, data.user?.id as string, reg, data.JWKpublicKey);
		}

		if (data.notifications && data.path !== Routes.notification_my.url) {
			if (data.notificationsCount == 1) {
				toast('Tienes una notificación sin leer', {
					icon: '🔔'
				});
			} else if (data.notificationsCount > 1) {
				toast(`Tienes ${data.notificationsCount} notificaciones sin leer`, {
					icon: '🔔'
				});
			}
		}
	});
</script>

<Toaster />

<div class="h-screen main-div">
	<Nav
		userIsLogged={data.userIsLogged}
		userPicture={data.user?.picture || ''}
		notificationsCount={data.notificationsCount}
	/>

	{#if data.isProtectedRoute && !data.userIsLogged}
		<div class="alert alert-error">
			<p>{data.protectedRouteMessage}</p>
			<p>
				<a href={Routes.login.url} class="btn btn-accent">{Routes.login.name}</a>
			</p>
		</div>
	{:else}
		{@render children()}
	{/if}
</div>
