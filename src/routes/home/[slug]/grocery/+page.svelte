<script lang="ts">
	import { Routes } from '$lib/routes';
	import { userSchema } from '$lib/schemas/user';
	import Form from '$lib/components/Form.svelte';
	import { t } from '$lib/translations';

	import type { PageData } from './$types';

	let {
		data
	}: {
		data: PageData;
	} = $props();

	const superform = data.form;
</script>
