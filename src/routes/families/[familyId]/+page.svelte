<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Modal } from '@callepuzzle/svelte-ui';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Crown from '@lucide/svelte/icons/crown';
	import LogOut from '@lucide/svelte/icons/log-out';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import { m } from '$lib/paraglide/messages.js';
	import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** Un miembro de la lista que trae el load. */
	type Member = PageProps['data']['family']['members'][number];

	const familia = $derived(data.family);
	const viewer = $derived(familia.viewer);

	/** Miembro elegido para expulsar: título del modal compartido y su form. */
	let miembroExpulsado: Member | undefined = $state();

	// Referencias a los modales para cerrarlos cuando la operación sale bien
	// (el componente exporta `showModal` y `close`).
	let kickModal: { showModal(): void; close(): void } | undefined = $state();
	let leaveModal: { showModal(): void; close(): void } | undefined = $state();
	let deleteModal: { showModal(): void; close(): void } | undefined = $state();

	// El error de cada operación se enseña DENTRO de su modal, que sigue
	// abierto: el de éxito cierra y el load revalidado ya muestra el estado
	// nuevo. El de promover (sin modal) cae al aviso de página (`form.error`).
	let kickError: string | null = $state(null);
	let leaveError: string | null = $state(null);
	let deleteError: string | null = $state(null);

	/** El `update` que `use:enhance` da a su callback (aplica el resultado). */
	type EnhanceUpdate = () => Promise<void>;

	/**
	 * Trata el resultado de una acción cuyo formulario vive en un modal: el
	 * fallo lo deja abierto con su mensaje; el éxito lo cierra y deja que
	 * `update` revalide (el redirect de salir/borrar lo sigue el router igual
	 * que un formulario sin JS).
	 */
	async function modalResult(
		result: ActionResult,
		update: EnhanceUpdate,
		setError: (message: string | null) => void,
		close: () => void
	): Promise<void> {
		if (result.type === 'failure') {
			const failure = result.data as { error?: string } | undefined;
			setError(failure?.error ?? m.families_members_error());
		} else {
			setError(null);
			close();
		}
		await update();
	}

	// Un `SubmitFunction` por acción: la referencia al modal y el `setError` se
	// leen al RESOLVERSE (`?.` sobre la `$state`), no al montar la página.
	const onKickResult: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await modalResult(
				result,
				update,
				(message) => (kickError = message),
				() => kickModal?.close()
			);
		};

	const onLeaveResult: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await modalResult(
				result,
				update,
				(message) => (leaveError = message),
				() => leaveModal?.close()
			);
		};

	const onDeleteResult: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await modalResult(
				result,
				update,
				(message) => (deleteError = message),
				() => deleteModal?.close()
			);
		};

	// Al (re)abrir cada modal se limpia el rastro del intento anterior.
	function abrirExpulsion(miembro: Member) {
		kickError = null;
		miembroExpulsado = miembro;
		kickModal?.showModal();
	}

	function abrirSalida(showModal: () => void) {
		leaveError = null;
		showModal();
	}

	function abrirBorrado(showModal: () => void) {
		deleteError = null;
		showModal();
	}
</script>

<svelte:head>
	<title>{m.families_members_title({ family: familia.name })} · {m.app_brand()}</title>
</svelte:head>

<section class="mx-auto max-w-md">
	<p>
		<a href={resolve('/families')} class="btn btn-ghost btn-sm -ml-2">
			<ArrowLeft aria-hidden="true" />
			{m.ui_back()}
		</a>
	</p>

	<h1 class="text-2xl font-bold">{m.families_members_title({ family: familia.name })}</h1>

	<!-- Aviso de las acciones sin modal (promover); las de modal llevan el
	     suyo dentro. -->
	{#if form?.error}
		<div class="alert alert-error mt-4 text-sm" role="alert">
			{form.error}
		</div>
	{/if}

	<ul class="mt-4 flex flex-col gap-2">
		{#each familia.members as miembro (miembro.id)}
			<li
				class="bg-base-200 rounded-box flex flex-wrap items-center justify-between gap-2 px-4 py-3"
			>
				<div class="min-w-0">
					<p class="flex items-center gap-2 font-medium">
						<span class="truncate">{miembro.name}</span>
						{#if miembro.id === viewer?.memberId}
							<span class="text-sm font-normal opacity-60">({m.families_member_you()})</span>
						{/if}
					</p>
					<p class="truncate text-sm opacity-70">{miembro.email}</p>
				</div>

				<div class="flex items-center gap-1">
					{#if miembro.isAdmin}
						<span class="badge badge-primary gap-1">
							<Crown aria-hidden="true" class="size-3" />
							{m.families_role_admin()}
						</span>
					{:else}
						<span class="badge badge-ghost">{m.families_role_member()}</span>
					{/if}

					<!-- Acciones de admin sobre OTROS miembros: promover (issue #62)
					     y expulsar con confirmación. El guard del endpoint es quien
					     autoriza de verdad; la UI solo no las pinta. -->
					{#if viewer?.isAdmin && miembro.id !== viewer.memberId}
						{#if !miembro.isAdmin}
							<form method="POST" action="?/promote" use:enhance>
								<input type="hidden" name="miembro" value={miembro.id} />
								<button type="submit" class="btn btn-ghost btn-sm" title={m.families_promote()}>
									<Crown aria-hidden="true" />
									<span class="sr-only">{m.families_promote()}</span>
								</button>
							</form>
						{/if}
						<button
							type="button"
							class="btn btn-ghost btn-sm"
							title={m.families_kick()}
							onclick={() => abrirExpulsion(miembro)}
						>
							<UserMinus aria-hidden="true" />
							<span class="sr-only">{m.families_kick()}</span>
						</button>
					{/if}
				</div>
			</li>
		{/each}
	</ul>

	<!-- Salir de la familia (issue #62): para cualquier miembro, admin o no;
	     si es el último admin, el servidor lo rechaza con la explicación. -->
	<div class="mt-6">
		<Modal
			bind:this={leaveModal}
			type="X"
			boxClass="modal-box max-w-md"
			strings={{ close: m.ui_close() }}
		>
			{#snippet trigger({ showModal })}
				<button type="button" class="btn btn-outline" onclick={() => abrirSalida(showModal)}>
					<LogOut aria-hidden="true" />
					{m.families_leave()}
				</button>
			{/snippet}

			<h2 class="text-lg font-bold">{m.families_leave_title({ family: familia.name })}</h2>
			<p class="mt-1 text-sm opacity-70">{m.families_leave_description()}</p>

			{#if leaveError}
				<div class="alert alert-error mt-3 text-sm" role="alert">
					{leaveError}
				</div>
			{/if}

			<form
				method="POST"
				action="?/leave"
				use:enhance={onLeaveResult}
				class="mt-4 flex justify-end"
			>
				<input type="hidden" name="miembro" value={viewer?.memberId ?? ''} />
				<button type="submit" class="btn btn-error">{m.families_leave_confirm()}</button>
			</form>
		</Modal>
	</div>

	<!-- Zona de peligro (issue #62): borrar la familia, solo admin. -->
	{#if viewer?.isAdmin}
		<div class="border-error/40 rounded-box mt-8 flex flex-col gap-3 border p-4">
			<h2 class="text-error flex items-center gap-2 text-sm font-bold">
				<ShieldAlert aria-hidden="true" />
				{m.families_danger_zone()}
			</h2>

			<Modal
				bind:this={deleteModal}
				type="X"
				boxClass="modal-box max-w-md"
				strings={{ close: m.ui_close() }}
			>
				{#snippet trigger({ showModal })}
					<button
						type="button"
						class="btn btn-error btn-outline"
						onclick={() => abrirBorrado(showModal)}
					>
						<Trash2 aria-hidden="true" />
						{m.families_delete_title({ family: familia.name })}
					</button>
				{/snippet}

				<h2 class="text-lg font-bold">{m.families_delete_title({ family: familia.name })}</h2>
				<p class="mt-1 text-sm opacity-70">{m.families_delete_description()}</p>

				{#if deleteError}
					<div class="alert alert-error mt-3 text-sm" role="alert">
						{deleteError}
					</div>
				{/if}

				<form
					method="POST"
					action="?/delete"
					use:enhance={onDeleteResult}
					class="mt-4 flex justify-end"
				>
					<button type="submit" class="btn btn-error">{m.families_delete_confirm()}</button>
				</form>
			</Modal>
		</div>
	{/if}
</section>

<!-- Expulsar (issue #62): una modal compartida; cada botón de la lista fija
     a quién se expulsa antes de abrirla. -->
<Modal
	bind:this={kickModal}
	type="X"
	showButton={false}
	boxClass="modal-box max-w-md"
	strings={{ close: m.ui_close() }}
>
	<h2 class="text-lg font-bold">
		{m.families_kick_title({ name: miembroExpulsado?.name ?? '' })}
	</h2>
	<p class="mt-1 text-sm opacity-70">{m.families_kick_description()}</p>

	{#if kickError}
		<div class="alert alert-error mt-3 text-sm" role="alert">
			{kickError}
		</div>
	{/if}

	<form method="POST" action="?/kick" use:enhance={onKickResult} class="mt-4 flex justify-end">
		<input type="hidden" name="miembro" value={miembroExpulsado?.id ?? ''} />
		<button type="submit" class="btn btn-error">{m.families_kick_confirm()}</button>
	</form>
</Modal>
