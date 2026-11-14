import { describe, expect, it } from 'vitest';
import { dayPantryStatus } from './pantry-status.js';

// El estado de despensa por día (#244). Cálculo PURO: sin fechas, zonas ni
// base — solo números exactos en coma flotante (los mismos que guarda la BD
// con 3 decimales), deterministas en cualquier máquina.

describe('dayPantryStatus', () => {
	it('da «suficiente» cuando la despensa cubre justo la necesidad del día', () => {
		const statuses = dayPantryStatus(
			[{ ingredients: [{ pantryItemId: 'huevos', quantity: 12 }] }],
			{
				huevos: 12
			}
		);
		expect(statuses.get('huevos')).toEqual({ status: 'enough', deficit: 0 });
	});

	it('suma el MISMO producto repetido en dos comidas del día antes de comparar', () => {
		// 6 huevos en la comida y 6 en la cena contra 12 en despensa: por
		// separado sobrarían dos «suficiente», agregados llega justo.
		const statuses = dayPantryStatus(
			[
				{ ingredients: [{ pantryItemId: 'huevos', quantity: 6 }] },
				{ ingredients: [{ pantryItemId: 'huevos', quantity: 6 }] }
			],
			{ huevos: 12 }
		);
		expect(statuses.get('huevos')).toEqual({ status: 'enough', deficit: 0 });
	});

	it('también agrega dentro de la misma comida', () => {
		const statuses = dayPantryStatus(
			[
				{
					ingredients: [
						{ pantryItemId: 'huevos', quantity: 4 },
						{ pantryItemId: 'huevos', quantity: 2 }
					]
				}
			],
			{ huevos: 12 }
		);
		expect(statuses.get('huevos')).toEqual({ status: 'enough', deficit: 0 });
	});

	it('da «insuficiente» con el déficit exacto cuando la despensa no llega', () => {
		const statuses = dayPantryStatus(
			[{ ingredients: [{ pantryItemId: 'leche', quantity: 1.5 }] }],
			{ leche: 1 }
		);
		expect(statuses.get('leche')).toEqual({ status: 'short', deficit: 0.5 });
	});

	it('el déficit nunca es negativo: lo que sobra no se descuenta', () => {
		const statuses = dayPantryStatus(
			[{ ingredients: [{ pantryItemId: 'arroz', quantity: 0.5 }] }],
			{ arroz: 3 }
		);
		expect(statuses.get('arroz')).toEqual({ status: 'enough', deficit: 0 });
	});

	it('los ingredientes sin producto de despensa (pantryItemId null) cuentan como «falta»', () => {
		// Sin FK no hay producto que consultar: falta TODO lo que pide, con
		// la despensa llena o vacía — da igual, no la mira.
		const statuses = dayPantryStatus([{ ingredients: [{ pantryItemId: null, quantity: 500 }] }], {
			loQueSea: 99
		});
		expect(statuses.get(null)).toEqual({ status: 'missing', deficit: 500 });
	});

	it('agrega los ingredientes sin producto bajo la misma clave null', () => {
		const statuses = dayPantryStatus(
			[
				{ ingredients: [{ pantryItemId: null, quantity: 100 }] },
				{ ingredients: [{ pantryItemId: null, quantity: 50 }] }
			],
			{}
		);
		expect(statuses.get(null)).toEqual({ status: 'missing', deficit: 150 });
	});

	it('un producto enlazado que falte en el mapa del load cuenta con despensa 0', () => {
		// Imposible hoy (la FK vive en la despensa de la familia y borrar el
		// producto la anula con SetNull), pero el cálculo es total: sin fila
		// es no tener nada.
		const statuses = dayPantryStatus(
			[{ ingredients: [{ pantryItemId: 'fantasma', quantity: 2 }] }],
			{}
		);
		expect(statuses.get('fantasma')).toEqual({ status: 'short', deficit: 2 });
	});

	it('cada producto lleva SU estado: los tres conviven en el mismo día', () => {
		// Un día de dos comidas: los huevos llegan justos (repetidos),
		// la leche no llega, y el pimentón va sin producto de despensa.
		const statuses = dayPantryStatus(
			[
				{
					ingredients: [
						{ pantryItemId: 'huevos', quantity: 6 },
						{ pantryItemId: 'leche', quantity: 1.5 },
						{ pantryItemId: null, quantity: 0.5 }
					]
				},
				{ ingredients: [{ pantryItemId: 'huevos', quantity: 6 }] }
			],
			{ huevos: 12, leche: 1 }
		);
		expect(statuses.get('huevos')).toEqual({ status: 'enough', deficit: 0 });
		expect(statuses.get('leche')).toEqual({ status: 'short', deficit: 0.5 });
		expect(statuses.get(null)).toEqual({ status: 'missing', deficit: 0.5 });
	});

	it('un día sin ingredientes da el mapa vacío', () => {
		expect(dayPantryStatus([], { huevos: 12 }).size).toBe(0);
		expect(dayPantryStatus([{ ingredients: [] }], {}).size).toBe(0);
	});
});
