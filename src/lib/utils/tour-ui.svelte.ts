/**
 * Estado UI compartido del tour de onboarding (#144): el módulo del tour
 * (`tour.ts`) lo escribe cuando el diálogo del tour pasa a visible —y cuando
 * deja de estarlo— y el layout lo lee para cerrar el cajón lateral vía
 * `bind:open` del `Drawer` (svelte-ui 1.2.0), sin simular clicks sobre el
 * checkbox oculto.
 *
 * En un `.svelte.ts` porque los runes no compilan en un `.ts` normal (mismo
 * motivo que `src/lib/refetch-on-visible.svelte.ts`). Objeto `$state` y no
 * `let` exportado: el estado exportado no se reasigna fuera de su módulo,
 * sólo se muta por propiedad.
 */
export const tourUi = $state({
	/** Hay diálogo del tour visible en pantalla. */
	dialogVisible: false
});
