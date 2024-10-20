<script lang="ts">
	import { t } from '$lib/translations';
	import { onMount } from 'svelte';
	import Form from '$lib/components/forms/Form.svelte';
	import { Icon } from 'svelte-icons-pack';
	import { AiOutlinePlusSquare } from 'svelte-icons-pack/ai';
	import { AiOutlineEdit } from 'svelte-icons-pack/ai';
	import { upperFirst } from 'lodash-es';
	import { type SuperValidated, type Infer, type SuperForm } from 'sveltekit-superforms';
	import type { Snippet } from 'svelte';
	import type { SuperFormData } from 'sveltekit-superforms/client';

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
		iconSize = '4em',
		excludeFields = [],
		extraFields
	}: {
		id?: string;
		title: string;
		superform: SuperValidated<Infer<any>>;
		schema: any;
		type: string;
		action?: Action;
		iconSize?: string;
		excludeFields?: string[];
		extraFields?: Snippet<[SuperForm<any, any>, SuperFormData<any>]>;
	} = $props();

	function showModal() {
		modal.showModal();
	}
	onMount(() => {
		modal = document.getElementById(id + 'add_edit_' + type);
	});

	if (action === 'edit') {
		icon = AiOutlineEdit;
	}
	formAction = '?/' + action + upperFirst(type);

	function onshowCallback() {
		console.log('onshowCallback');
		setTimeout(() => {
			modal.close();
		}, 1000);
	}
</script>

<button onclick={showModal}><Icon src={icon} size={iconSize} /></button>

<dialog id="{id}add_edit_{type}" class="modal">
	<div class="modal-box">
		<h3 class="text-lg font-bold">{title}</h3>
		<Form
			{id}
			{schema}
			{superform}
			{type}
			{excludeFields}
			action={formAction}
			{onshowCallback}
			{extraFields}
		></Form>
		<div class="modal-action">
			<form method="dialog">
				<button class="btn">{$t('index.close')}</button>
			</form>
		</div>
	</div>
</dialog>
