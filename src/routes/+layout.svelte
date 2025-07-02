<script lang="ts">
	import '../app.css';
	import { Header } from 'storybook-svelte';
	import { routes } from 'storybook-svelte';

	import type { PageData } from './$types';
	import type { Snippet } from 'svelte';

	let { children, data }: { children: Snippet; data: PageData } = $props();
</script>

<Header title="NavNar Title" {routes}>
	{@render children()}
</Header>
