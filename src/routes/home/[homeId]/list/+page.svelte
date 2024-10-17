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

<ListOf
	h2title="Listado de productos"
	items={data.lists}
	forms={data.forms}
	type="list"
	schema={ListSchema}
	schemaWithId={ListSchemaWithId}
>
	{#snippet card(item)}
		<div class="flex flex-col basis-1/2">
			<h3 class="card-title">
				<a href={Routes.list_detail.generateUrl({ homeId: data.home.id, id: item.id })}>
					{item.name}
				</a>
			</h3>
			<p>{item.description}</p>
		</div>
	{/snippet}
</ListOf>
