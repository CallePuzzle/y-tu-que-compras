<script lang="ts">
	import { onMount } from 'svelte';
	import { Icon } from 'svelte-icons-pack';

	import type { IconType } from 'svelte-icons-pack';

	let {
		icon,
		size = '2.5em'
	}: {
		icon: string;
		size?: string;
	} = $props();

	let iconComponent: IconType | undefined = $state();

	onMount(async () => {
		try {
			iconComponent = (await import(`svelte-icons-pack/ai`))[icon] as IconType;
		} catch (error) {
			console.error('Error loading icon:', error);
		}
	});
</script>

{#if iconComponent}
	<Icon src={iconComponent} {size} />
{/if}
