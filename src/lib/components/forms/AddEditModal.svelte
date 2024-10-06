<script lang="ts">
	import { t } from '$lib/translations';
	import { onMount } from 'svelte';
	import Form from '$lib/components/forms/Form.svelte';
	import { Icon } from 'svelte-icons-pack';
	import { AiOutlinePlusSquare } from 'svelte-icons-pack/ai';

	let modal: HTMLElement | null = null;

	let {
		id = '',
		title,
		superform,
		schema,
		type,
		action
	}: {
		id?: string;
		title: string;
		superform: any;
		schema: any;
		type: string;
		action?: string;
	} = $props();

	function showModal() {
		modal.showModal();
	}
	onMount(() => {
		modal = document.getElementById(id + 'add_edit_' + type);
	});
</script>

<button onclick={showModal}><Icon src={AiOutlinePlusSquare} size="4em" /></button>

<dialog id="{id}add_edit_{type}" class="modal">
	<div class="modal-box">
		<h3 class="text-lg font-bold">{title}</h3>
		<Form {schema} {superform} {type} {action} />
		<div class="modal-action">
			<form method="dialog">
				<button class="btn">{$t('index.close')}</button>
			</form>
		</div>
	</div>
</dialog>
