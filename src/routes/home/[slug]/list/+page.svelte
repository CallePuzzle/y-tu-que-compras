<script lang="ts">
	import { ListSchema, ListSchemaWithId } from '$lib/schemas';
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
	items={data.lists}
	forms={data.forms}
	type="list"
	schema={ListSchema}
	schemaWithId={ListSchemaWithId}
/>
