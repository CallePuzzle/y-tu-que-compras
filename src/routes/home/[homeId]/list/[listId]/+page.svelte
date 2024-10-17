<script lang="ts">
	import { ListSchema, ListSchemaWithId } from '$lib/schemas';
	import ListOf from '$lib/components/ListOf.svelte';
	import { Routes } from '$lib/routes';

	import type { PageData } from './$types';

	let {
		data
	}: {
		data: PageData;
	} = $props();
</script>

<div class="flex flex-col place-items-center">
	<h2 class="text-2xl m-2">{data.list.name}</h2>
	{#each data.list.groceries as item, index}
		<div class="card bg-neutral text-neutral-content w-96 my-1">
			<div class="card-body flex flex-row items-center">
				<div class="flex flex-col basis-1/2">
					<h3 class="card-title">{item.grocery.name}</h3>
				</div>
			</div>
		</div>
	{/each}
</div>
