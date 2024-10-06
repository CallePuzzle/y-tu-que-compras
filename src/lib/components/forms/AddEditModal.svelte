<script lang="ts">
	import { t } from '$lib/translations';
	import { onMount } from 'svelte';
	import Form from '$lib/components/forms/Form.svelte';
	import { Icon } from 'svelte-icons-pack';
	import { AiOutlinePlusSquare } from 'svelte-icons-pack/ai';
	import { AiOutlineEdit } from 'svelte-icons-pack/ai';
	import { upperFirst } from 'lodash-es';

	type Action = 'add' | 'edit';
	let modal: HTMLElement | null = null;
	let icon = $state(AiOutlinePlusSquare);
	let formAction = $state('');

	let {
		id = '',
		title,
		superform,
		schema,
		type,
		action,
		iconSize = '4em'
	}: {
		id?: string;
		title: string;
		superform: any;
		schema: any;
		type: string;
		action?: Action;
		iconSize?: string;
	} = $props();

	function showModal() {
		modal.showModal();
	}
	onMount(() => {
		modal = document.getElementById(id + 'add_edit_' + type);
	});

	$effect(() => {
		if (action === 'edit') {
			icon = AiOutlineEdit;
		}
		formAction = '?/' + action + upperFirst(type);
	});
</script>

<button onclick={showModal}><Icon src={icon} size={iconSize} /></button>

<dialog id="{id}add_edit_{type}" class="modal">
	<div class="modal-box">
		<h3 class="text-lg font-bold">{title}</h3>
		<Form {schema} {superform} {type} action={formAction} />
		<div class="modal-action">
			<form method="dialog">
				<button class="btn">{$t('index.close')}</button>
			</form>
		</div>
	</div>
</dialog>
