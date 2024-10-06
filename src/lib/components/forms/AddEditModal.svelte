<script lang="ts">
	import { t } from '$lib/translations';
	import Form from '$lib/components/forms/Form.svelte';
	import { Icon } from 'svelte-icons-pack';
	import { AiOutlinePlusSquare } from 'svelte-icons-pack/ai';

	let {
		title,
		superform,
		schema,
		type,
		action
	}: {
		title: string;
		superform: any;
		schema: any;
		type: string;
		action?: string;
	} = $props();

	function showModal() {
		const modal = document.getElementById('add_edit_' + type);
		modal.showModal();
	}
</script>

<button onclick={showModal}><Icon src={AiOutlinePlusSquare} size="4em" /></button>

<dialog id="add_edit_{type}" class="modal">
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
