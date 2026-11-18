<script lang="ts">
	import { resolve } from '$app/paths';
	import { zodToFieldsJsonSchema } from '@callepuzzle/core/schema';
	import { FormFields, Modal } from '@callepuzzle/svelte-ui';
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ConfirmModal from '#lib/components/ConfirmModal.svelte';
	import { formatDateTime } from '#lib/format.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getLocale } from '#lib/paraglide/runtime.js';
	import { apiTokenCreateSchema } from '#lib/schemas/api-token.js';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { superForm } from 'sveltekit-superforms/client';
	import type { PageProps } from './$types';

	let { data, form: actionData }: PageProps = $props();

	/** Una fila del listado (la trae el load, ya ordenada por creación). */
	type TokenRow = PageProps['data']['tokens'][number];

	/** El token recién creado, tal y como lo devuelve la acción de crear. */
	interface CreatedToken {
		key: string;
		start: string | null;
		name: string;
	}

	// El alta muestra la clave UNA vez: al cerrar el aviso el objeto desaparece
	// del cliente, y el servidor ya no puede volver a servir la clave (el plugin
	// solo guardó su hash). Sin JS, la acción deja el token en `form` y la página
	// lo pinta igual al recargar; el «Ya lo he guardado» es un enlace que, sin
	// JS, navega y devuelve la página limpia.
	// svelte-ignore state_referenced_locally
	let revealedToken: CreatedToken | undefined = $state(
		(actionData as { apiKey?: CreatedToken } | undefined)?.apiKey
	);

	// Modal de crear (patrón /categories): referencia para abrir por código y
	// cerrarla cuando el alta sale bien.
	let createModal: { showModal(): void; close(): void } | undefined = $state();

	// El schema se construye EN RENDER, nunca en scope de módulo (regla i18n de
	// la librería). `superForm` no soporta cambiar el schema, así que se lee una
	// vez por instancia; si el idioma cambia con la página abierta, los mensajes
	// se re-traducen al recargar (igual que en /categories).
	const schema = apiTokenCreateSchema({
		nameError: m.schema_settings_api_tokens_name_error(),
		nameLabel: m.schema_settings_api_tokens_name_label(),
		namePlaceholder: m.schema_settings_api_tokens_name_placeholder()
	});

	const fields = zodToFieldsJsonSchema(schema).filter((field) => field.kind === 'string');

	// Copiar al portapapeles el token recién creado. El fallback es no hacer
	// nada: sin permiso (o sin gesto) el código sigue a la vista para copiarlo
	// a mano, que es el camino de siempre.
	let copied = $state(false);

	// superForm se llama UNA vez por instancia (gestiona su estado reactivo
	// interno); envolverlo en `$derived` lo reinvocaría y rompería el formulario.
	// svelte-ignore state_referenced_locally
	const form = superForm(data.form, {
		validators: zod4Client(schema),
		onResult({ result }) {
			if (result.type === 'success') {
				const data = result.data as { apiKey?: CreatedToken } | undefined;
				// El token en claro viaja en el resultado de la acción: fuera modal,
				// aviso con la clave. `update()` (superforms) ya revalidó el load y
				// el listado repinta el token nuevo.
				revealedToken = data?.apiKey;
				copied = false;
				createModal?.close();
			}
		}
	});
	const { form: formData, enhance, delayed, message, errors } = form;

	/** Abre el modal de creación: vacío, sin rastro del intento anterior. */
	function openCreate() {
		message.set(undefined);
		errors.clear();
		form.reset();
		createModal?.showModal();
	}

	async function copyKey() {
		if (!revealedToken) return;
		try {
			await navigator.clipboard.writeText(revealedToken.key);
			copied = true;
		} catch {
			// Portapapeles no disponible: la clave sigue visible.
		}
	}

	/** «Ya lo he guardado»: destruye el token del cliente y con él el aviso. */
	function dismissRevealed(event: MouseEvent) {
		if (!revealedToken) return;
		// Con JS no hace falta recargar: fuera token y fuera del DOM. Sin JS el
		// enlace navega (GET) y la página vuelve sin `form`, igual de limpia.
		event.preventDefault();
		revealedToken = undefined;
	}

	// Revocar con confirmación, patrón /categories: una modal compartida; cada
	// fila fija qué token se revoca antes de abrirla. El aviso de éxito va
	// FUERA de la modal, como en las demás vistas de gestión.
	let revokeModal: ConfirmModal | undefined = $state();
	let revokedToken: TokenRow | undefined = $state();
	let successMessage: string | null = $state(null);

	function openRevoke(token: TokenRow) {
		revokedToken = token;
		revokeModal?.showModal();
	}
</script>

<svelte:head>
	<title>{m.settings_api_tokens_title()} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<div class="flex items-center justify-between gap-2">
		<h1 class="text-2xl font-bold">{m.settings_api_tokens_title()}</h1>
		<button type="button" class="btn btn-primary btn-sm" onclick={() => openCreate()}>
			<Plus aria-hidden="true" />
			{m.settings_api_tokens_create()}
		</button>
	</div>

	<p class="mt-2 text-sm opacity-70">{m.settings_api_tokens_description()}</p>

	{#if revealedToken}
		<!-- El token en claro, UNA sola vez: este bloque se destruye al cerrarlo y
		     el servidor ya no puede volver a servir la clave (solo guardó el hash). -->
		<div class="alert alert-info mt-4 flex-col items-stretch text-sm" role="status">
			<p class="font-bold">
				{m.settings_api_tokens_created_title({ name: revealedToken.name })}
			</p>
			<code class="font-mono break-all">{revealedToken.key}</code>
			<p>{m.settings_api_tokens_created_warning()}</p>
			<div class="mt-1 flex justify-end gap-2">
				<button type="button" class="btn btn-ghost btn-sm" onclick={() => copyKey()}>
					{#if copied}
						<Check aria-hidden="true" />
						{m.settings_api_tokens_copied()}
					{:else}
						<Copy aria-hidden="true" />
						{m.settings_api_tokens_copy()}
					{/if}
				</button>
				<a
					href={resolve('/settings/api-tokens')}
					class="btn btn-primary btn-sm"
					onclick={dismissRevealed}
				>
					{m.settings_api_tokens_created_done()}
				</a>
			</div>
		</div>
	{/if}

	{#if successMessage}
		<div class="alert alert-success mt-4 text-sm" role="status">
			{successMessage}
		</div>
	{/if}

	{#if data.tokens.length === 0}
		<!-- Estado vacío con CTA. -->
		<div class="mt-8 flex flex-col items-center gap-3 text-center">
			<KeyRound aria-hidden="true" class="size-10 opacity-40" />
			<p class="opacity-70">{m.settings_api_tokens_empty()}</p>
			<button type="button" class="btn btn-primary" onclick={() => openCreate()}>
				<Plus aria-hidden="true" />
				{m.settings_api_tokens_create()}
			</button>
		</div>
	{:else}
		<!-- `ol`, como las categorías: del más nuevo al más viejo (el orden que trae el load). -->
		<ol class="mt-4 flex flex-col gap-2">
			{#each data.tokens as token (token.id)}
				<li class="bg-base-200 rounded-box flex items-center gap-1 px-3 py-2">
					<div class="min-w-0 flex-1">
						<p class="truncate font-medium">{token.name ?? '—'}</p>
						<!-- El prefijo (los primeros caracteres que el plugin guarda para
						     reconocer la clave) es lo único de ella que sigue visible. -->
						<p class="text-sm">
							<code class="font-mono opacity-70">{token.start ? `${token.start}…` : '—'}</code>
						</p>
						<p class="text-sm opacity-70">
							{m.settings_api_tokens_created_at()}
							{formatDateTime(token.createdAt, getLocale())}
							·
							{#if token.lastUsedAt}
								{m.settings_api_tokens_last_used()}
								{formatDateTime(token.lastUsedAt, getLocale())}
							{:else}
								{m.settings_api_tokens_never_used()}
							{/if}
						</p>
					</div>
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						title={m.settings_api_tokens_revoke()}
						onclick={() => openRevoke(token)}
					>
						<Trash2 aria-hidden="true" />
						<span class="sr-only">{m.settings_api_tokens_revoke()}</span>
					</button>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<!-- Crear: el nombre basta; la caducidad y los permisos los fija el servidor
     (T1.1: sin caducidad por defecto, permisos del core de la app). -->
<Modal
	bind:this={createModal}
	type="X"
	showButton={false}
	boxClass="modal-box max-w-md"
	strings={{ close: m.ui_close() }}
>
	<h2 class="text-lg font-bold">{m.settings_api_tokens_create()}</h2>

	<form method="POST" action="?/create" use:enhance class="mt-4 flex flex-col gap-4">
		<FormFields
			{form}
			{formData}
			{fields}
			strings={{ required: m.form_required(), optional: m.form_optional() }}
		/>

		{#if $message}
			<div class="alert alert-error text-sm" role="alert">
				{$message}
			</div>
		{/if}

		<button type="submit" class="btn btn-primary" disabled={$delayed}>
			{#if $delayed}
				<span class="loading loading-spinner"></span>
			{/if}
			{m.settings_api_tokens_create()}
		</button>
	</form>
</Modal>

<!-- Revocar: una modal compartida; cada botón de la fila fija qué token se
     revoca antes de abrirla. -->
<ConfirmModal
	bind:this={revokeModal}
	title={m.settings_api_tokens_revoke_title({ name: revokedToken?.name ?? '' })}
	description={m.settings_api_tokens_revoke_description()}
	confirmLabel={m.settings_api_tokens_revoke_confirm()}
	action="?/revoke"
	fields={{ tokenId: revokedToken?.id ?? '' }}
	errorFallback={m.settings_api_tokens_error()}
	onSuccess={() => (successMessage = m.settings_api_tokens_revoked())}
/>
