<script lang="ts">
	import '../app.css';
	import { Header } from 'storybook-svelte';
	// import { routes } from 'storybook-svelte';
	import { session, authClient } from '$lib/auth-client';

	import type { PageData } from './$types';
	import type { Snippet } from 'svelte';

	// console.log('session: ', session);

	let { children, data }: { children: Snippet; data: PageData } = $props();
</script>

<!-- <Header title="NavNar Title" {routes} {session} {authClient}>
	{@render children()}

	<p>Logged in as {$session.data?.user.email}</p>
</Header> -->
