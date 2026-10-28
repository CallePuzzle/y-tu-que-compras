import { invalidateAll } from '$app/navigation';

/**
 * Refresco al volver a la pestaña (checklist #69): varios miembros pueden
 * estar tocando lo mismo y la v1 no tiene tiempo real, así que lo barato y
 * suficiente es revalidar al volver a mirar. Se llama en la inicialización
 * del componente; el efecto quita su listener cuando la página se destruye.
 *
 * PERO superforms rehace los formularios de los modales con lo que trae el
 * load en cuanto se actualizan los datos de página: revalidar con un modal
 * abierto MACHACARÍA lo tecleado. El refresco espera a una vuelta sin ningún
 * `<dialog>` abierto y en la que `skip` (si lo hay) no lo frene — p. ej. un
 * formulario tocado: `form.isTainted()`, la consulta oficial de superforms
 * (el store `tainted` es un OBJETO, truthy en cuanto se teclea algo).
 */
export function useRefetchOnVisible(skip?: () => boolean): void {
	$effect(() => {
		function alVolver() {
			if (document.visibilityState !== 'visible') return;
			if (document.querySelector('dialog[open]') || skip?.()) return;
			void invalidateAll();
		}
		document.addEventListener('visibilitychange', alVolver);
		return () => document.removeEventListener('visibilitychange', alVolver);
	});
}
