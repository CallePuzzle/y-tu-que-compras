<script lang="ts">
	import { GrocerySchema, GrocerySchemaWithId } from '$lib/schemas';
	import ListOf from '$lib/components/ListOf.svelte';
	import type { PageData } from './$types';

	let {
		data
	}: {
		data: PageData;
	} = $props();
</script>

<ListOf
	h2title="Listado de productos"
	items={data.groceries}
	forms={data.forms}
	type="grocery"
	schema={GrocerySchema}
	schemaWithId={GrocerySchemaWithId}
>
	{#snippet card(item)}
		<div class="flex flex-col basis-1/2">
			<h3 class="card-title">{item.name}</h3>
			<p>{item.description}</p>
		</div>
	{/snippet}
</ListOf>
