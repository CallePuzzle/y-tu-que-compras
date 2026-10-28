import { m } from '$lib/paraglide/messages.js';
import { itemSchema } from '$lib/schemas/item.js';
import { purchaseSchema } from '$lib/schemas/purchase.js';

// Los schemas de la vista de lista, compartidos por el servidor (validación de
// las acciones) y los componentes (validación en cliente). Funciones y no
// constantes: se construyen EN REQUEST/RENDER, nunca en scope de módulo (regla
// i18n de la librería), para que los textos salgan en la locale de quien pide.
// Ojo en cliente: `superForm` no soporta cambiar el schema, así que se lee una
// vez por instancia; si el idioma cambia con la página abierta, los mensajes
// se re-traducen al recargar.

export function itemFormSchema() {
	return itemSchema({
		nameError: m.schema_items_name_error(),
		nameLabel: m.schema_items_name_label(),
		namePlaceholder: m.schema_items_name_placeholder(),
		quantityError: m.schema_items_quantity_error(),
		quantityLabel: m.schema_items_quantity_label(),
		unitError: m.schema_items_unit_error(),
		unitLabel: m.schema_items_unit_label()
	});
}

export function purchaseFormSchema() {
	return purchaseSchema({
		totalError: m.schema_purchase_total_error(),
		totalLabel: m.schema_purchase_total_label()
	});
}
