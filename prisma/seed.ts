import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/lib/generated/prisma/client';

import type { MealType, Unit } from '../src/lib/generated/prisma/client';

// ============================================================================
// Seed de desarrollo (`bun run db:seed`): una familia de pruebas con datos
// suficientes para ejercitar toda la app contra la BD local (la DATABASE_URL
// del .env) sin pasar por la UI.
//
// - IDEMPOTENTE: borra la familia sembrada (por slug, con todo lo que cuelga
//   de ella vía ON DELETE CASCADE) y la vuelve a crear igual. Los usuarios van
//   por upsert (el email es único), así que una re-ejecución conserva sesiones
//   y cuentas, y NINGUNA otra familia se toca. Las invitaciones tienen el
//   contextId como columna plana (sin FK), por eso se limpian aparte.
// - El estado replica el que deja la app: roles como los siembra
//   `seedFamilyRoles` de `#lib/server/tenancy.ts`, nombres canónicos como los
//   calcula `normalizeItemName` (`$lib/normalize-name`) y snapshots del
//   historial como los deja `finalizePurchase` (#75). Los valores van
//   duplicados aquí a propósito: importar código de servidor arrastraría la
//   cadena de imports de `$app/env/private`, que solo resuelve dentro de Vite.
// ============================================================================

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
	throw new Error('DATABASE_URL no está definida: copia .env.example a .env y rellénala.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// Datos fijos (no aleatorios) para que la re-ejecución encuentre y sustituya lo sembrado.
const FAMILIA_NOMBRE = 'Familia García';
const FAMILIA_SLUG = 'familia-garcia';

const USUARIO_ADMIN = { email: 'maria@ytqc.test', name: 'María García' };
const USUARIO_MIEMBRO = { email: 'juan@ytqc.test', name: 'Juan Pérez' };
const EMAIL_INVITADA = 'lucia@ytqc.test';

const FAMILIA_ADMIN_STATEMENTS = [
	'organization:update',
	'organization:delete',
	'member:invite',
	'member:remove',
	'member:update',
	'invitation:cancel'
] as const;

const FAMILIA_MEMBER_STATEMENTS = ['organization:get'] as const;

const FAMILY_ROLE_TRANSLATIONS: Record<string, Record<string, string>> = {
	admin: { es: 'Administrador', en: 'Admin' },
	member: { es: 'Miembro', en: 'Member' }
};

/** Copia de `normalizeItemName` (`$lib/normalize-name`): el canónico de nombres propios. */
function normalizeItemName(name: string): string {
	return name
		.trim()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/\s+/g, ' ');
}

function daysAgo(days: number): Date {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** La clave `YYYY-MM-DD` que viaja por UI en los menús (la @db.Date del modelo). */
function dateKey(offsetDays = 0): string {
	return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function upsertUsuario(email: string, name: string) {
	return prisma.user.upsert({
		where: { email },
		create: { id: randomUUID(), name, email, emailVerified: true },
		update: {}
	});
}

/** Un rol de familia con sus statements y traducciones (ver `createFamilyRole` de tenancy.ts). */
async function createFamilyRole(
	familyId: string,
	roleName: string,
	statements: readonly string[]
): Promise<{ id: string }> {
	const now = new Date();
	const role = await prisma.role.create({
		data: {
			id: randomUUID(),
			contextType: 'organization',
			contextId: familyId,
			name: roleName,
			createdAt: now,
			updatedAt: now
		}
	});

	for (const statementId of statements) {
		await prisma.roleStatement.create({
			data: { id: randomUUID(), roleId: role.id, statementId, createdAt: now }
		});
	}

	for (const [locale, name] of Object.entries(FAMILY_ROLE_TRANSLATIONS[roleName])) {
		await prisma.roleTranslation.create({
			data: { id: randomUUID(), roleId: role.id, locale, name, createdAt: now }
		});
	}

	return role;
}

/** Roles admin y member de una familia, por nombre. */
async function seedFamilyRoles(familyId: string): Promise<{ admin: string; member: string }> {
	const admin = await createFamilyRole(familyId, 'admin', FAMILIA_ADMIN_STATEMENTS);
	const member = await createFamilyRole(familyId, 'member', FAMILIA_MEMBER_STATEMENTS);
	return { admin: admin.id, member: member.id };
}

async function addFamilyMember(options: {
	familyId: string;
	userId: string;
	roleId: string;
}): Promise<void> {
	const now = new Date();
	await prisma.member.create({
		data: {
			id: randomUUID(),
			contextType: 'organization',
			contextId: options.familyId,
			userId: options.userId,
			roleId: options.roleId,
			createdAt: now,
			updatedAt: now
		}
	});
}

async function main(): Promise<void> {
	// ---------------------------------------------------------------------------
	// 0. Limpieza de la semilla anterior (idempotencia)
	// ---------------------------------------------------------------------------
	const sembradaAntes = await prisma.organization.findUnique({ where: { slug: FAMILIA_SLUG } });
	if (sembradaAntes) {
		// contextId es columna plana en estas tablas (sin FK): no cascada.
		await prisma.invitation.deleteMany({
			where: { contextType: 'organization', contextId: sembradaAntes.id }
		});
		await prisma.permissionGrant.deleteMany({
			where: { contextType: 'organization', contextId: sembradaAntes.id }
		});
		await prisma.permissionDeny.deleteMany({
			where: { contextType: 'organization', contextId: sembradaAntes.id }
		});
		// El resto (listas, categorías, establecimientos, historial, despensa,
		// menús y recetas) muere con la familia por ON DELETE CASCADE en la BD.
		await prisma.organization.delete({ where: { id: sembradaAntes.id } });
	}

	// ---------------------------------------------------------------------------
	// 1. Usuarios y familia
	// ---------------------------------------------------------------------------
	const maria = await upsertUsuario(USUARIO_ADMIN.email, USUARIO_ADMIN.name);
	const juan = await upsertUsuario(USUARIO_MIEMBRO.email, USUARIO_MIEMBRO.name);

	const now = new Date();
	const familia = await prisma.organization.create({
		data: {
			id: randomUUID(),
			name: FAMILIA_NOMBRE,
			slug: FAMILIA_SLUG,
			createdAt: now,
			updatedAt: now
		}
	});

	const roles = await seedFamilyRoles(familia.id);
	await addFamilyMember({ familyId: familia.id, userId: maria.id, roleId: roles.admin });
	await addFamilyMember({ familyId: familia.id, userId: juan.id, roleId: roles.member });

	// ---------------------------------------------------------------------------
	// 2. Categorías (épica #164): position = el orden del listado
	// ---------------------------------------------------------------------------
	const nombresCategorias = [
		'Frutas y verduras',
		'Lácteos y huevos',
		'Pan y pastelería',
		'Carnes y pescado',
		'Alimentación',
		'Droguería y limpieza'
	];
	const categorias: Record<string, { id: string; name: string }> = {};
	for (const [position, name] of nombresCategorias.entries()) {
		const categoria = await prisma.category.create({
			data: {
				organizationId: familia.id,
				name,
				normalizedName: normalizeItemName(name),
				position,
				createdAt: now,
				updatedAt: now
			}
		});
		categorias[normalizeItemName(name)] = categoria;
	}
	const cat = (name: string) => categorias[normalizeItemName(name)];

	// ---------------------------------------------------------------------------
	// 3. Establecimientos (épica #177): createdAt escalonado para un orden
	//    determinista en el listado (ordena por creación)
	// ---------------------------------------------------------------------------
	let storeSeq = 0;
	async function createStore(name: string): Promise<string> {
		const createdAt = new Date(Date.now() - (storeSeq++ + 1) * 60_000);
		const store = await prisma.store.create({
			data: {
				organizationId: familia.id,
				name,
				normalizedName: normalizeItemName(name),
				createdAt,
				updatedAt: createdAt
			}
		});
		return store.id;
	}
	const mercadonaId = await createStore('Mercadona');
	const carrefourId = await createStore('Carrefour Express');
	await createStore('Panadería Ana');

	// ---------------------------------------------------------------------------
	// 4. Listas de la compra con items (issue #67): order = posición en la lista
	// ---------------------------------------------------------------------------
	async function createList(options: {
		name: string;
		color: string;
		icon: string;
		createdAt: Date;
		items: Array<{
			name: string;
			quantity: number;
			unit: Unit;
			categoria?: string;
			purchased?: boolean;
		}>;
	}): Promise<number> {
		const list = await prisma.list.create({
			data: {
				organizationId: familia.id,
				name: options.name,
				color: options.color,
				icon: options.icon,
				createdAt: options.createdAt,
				updatedAt: options.createdAt
			}
		});
		for (const [order, item] of options.items.entries()) {
			await prisma.item.create({
				data: {
					listId: list.id,
					name: item.name,
					quantity: item.quantity,
					unit: item.unit,
					categoryId: item.categoria ? cat(item.categoria).id : null,
					purchased: item.purchased ?? false,
					order,
					createdAt: options.createdAt,
					updatedAt: options.createdAt
				}
			});
		}
		return options.items.length;
	}

	let totalItems = await createList({
		name: 'Compra semanal',
		color: 'green',
		icon: 'shopping-basket',
		createdAt: new Date(Date.now() - 3 * 60_000),
		items: [
			{
				name: 'Leche entera',
				quantity: 2,
				unit: 'liter',
				categoria: 'Lácteos y huevos',
				purchased: true
			},
			{ name: 'Huevos', quantity: 1, unit: 'dozen', categoria: 'Lácteos y huevos' },
			{ name: 'Pan de molde', quantity: 1, unit: 'package', categoria: 'Pan y pastelería' },
			{ name: 'Plátanos', quantity: 1, unit: 'kilogram', categoria: 'Frutas y verduras' },
			{ name: 'Tomates', quantity: 500, unit: 'gram', categoria: 'Frutas y verduras' },
			{ name: 'Pollo entero', quantity: 1.5, unit: 'kilogram', categoria: 'Carnes y pescado' },
			{ name: 'Yogur natural', quantity: 6, unit: 'unit', categoria: 'Lácteos y huevos' },
			{ name: 'Papel higiénico', quantity: 2, unit: 'package', categoria: 'Droguería y limpieza' }
		]
	});
	totalItems += await createList({
		name: 'Limpieza',
		color: 'cyan',
		icon: 'washing-machine',
		createdAt: new Date(Date.now() - 2 * 60_000),
		items: [
			{
				name: 'Detergente líquido',
				quantity: 1,
				unit: 'package',
				categoria: 'Droguería y limpieza',
				purchased: true
			},
			{ name: 'Lejía', quantity: 2, unit: 'liter', categoria: 'Droguería y limpieza' },
			{ name: 'Estropajos', quantity: 1, unit: 'package', categoria: 'Droguería y limpieza' }
		]
	});
	totalItems += await createList({
		name: 'Cumpleaños de Lucía',
		color: 'pink',
		icon: 'gift',
		createdAt: new Date(Date.now() - 1 * 60_000),
		items: [
			{ name: 'Tarta de chocolate', quantity: 1, unit: 'unit', categoria: 'Pan y pastelería' },
			{ name: 'Velas', quantity: 2, unit: 'package' },
			{ name: 'Globos', quantity: 1, unit: 'package', purchased: true }
		]
	});

	// ---------------------------------------------------------------------------
	// 5. Despensa (issue #70): lo que deja `finalizePurchase` al cerrar compras
	// ---------------------------------------------------------------------------
	let pantrySeq = 0;
	async function createPantryItem(options: {
		name: string;
		quantity: number;
		unit: Unit;
		categoria?: string;
	}): Promise<void> {
		const createdAt = new Date(Date.now() - (pantrySeq++ + 1) * 60_000);
		await prisma.pantryItem.create({
			data: {
				organizationId: familia.id,
				name: options.name,
				normalizedName: normalizeItemName(options.name),
				quantity: options.quantity,
				unit: options.unit,
				categoryId: options.categoria ? cat(options.categoria).id : null,
				createdAt,
				updatedAt: createdAt
			}
		});
	}
	await createPantryItem({
		name: 'Leche entera',
		quantity: 1.5,
		unit: 'liter',
		categoria: 'Lácteos y huevos'
	});
	await createPantryItem({
		name: 'Arroz redondo',
		quantity: 1,
		unit: 'kilogram',
		categoria: 'Alimentación'
	});
	await createPantryItem({
		name: 'Aceite de oliva virgen extra',
		quantity: 1,
		unit: 'liter',
		categoria: 'Alimentación'
	});
	await createPantryItem({
		name: 'Café molido',
		quantity: 250,
		unit: 'gram',
		categoria: 'Alimentación'
	});
	await createPantryItem({
		name: 'Garbanzos cocidos',
		quantity: 2,
		unit: 'can',
		categoria: 'Alimentación'
	});
	await createPantryItem({
		name: 'Detergente',
		quantity: 2,
		unit: 'package',
		categoria: 'Droguería y limpieza'
	});

	// ---------------------------------------------------------------------------
	// 6. Historial de compras (issue #75): snapshots como los deja
	//    `finalizePurchase` — listName/storeName/categoryName congelados
	// ---------------------------------------------------------------------------
	async function createPurchase(options: {
		listName: string;
		listId?: string | null;
		storeId?: string | null;
		storeName?: string | null;
		total: number;
		userId: string;
		createdAt: Date;
		items: Array<{ name: string; quantity: number; unit: Unit; categoria?: string }>;
	}): Promise<void> {
		await prisma.purchaseRecord.create({
			data: {
				organizationId: familia.id,
				listId: options.listId ?? null,
				listName: options.listName,
				storeId: options.storeId ?? null,
				storeName: options.storeName ?? null,
				total: options.total,
				userId: options.userId,
				createdAt: options.createdAt,
				items: {
					create: options.items.map((item, position) => ({
						position,
						name: item.name,
						quantity: item.quantity,
						unit: item.unit,
						categoryId: item.categoria ? cat(item.categoria).id : null,
						categoryName: item.categoria ?? null
					}))
				}
			}
		});
	}

	await createPurchase({
		listName: 'Compra semanal',
		storeId: mercadonaId,
		storeName: 'Mercadona',
		total: 47.35,
		userId: maria.id,
		createdAt: daysAgo(7),
		items: [
			{ name: 'Leche entera', quantity: 2, unit: 'liter', categoria: 'Lácteos y huevos' },
			{ name: 'Huevos', quantity: 1, unit: 'dozen', categoria: 'Lácteos y huevos' },
			{ name: 'Pan de molde', quantity: 1, unit: 'package', categoria: 'Pan y pastelería' },
			{ name: 'Plátanos', quantity: 1, unit: 'kilogram', categoria: 'Frutas y verduras' },
			{ name: 'Tomates', quantity: 500, unit: 'gram', categoria: 'Frutas y verduras' },
			{ name: 'Pollo entero', quantity: 1.5, unit: 'kilogram', categoria: 'Carnes y pescado' }
		]
	});
	await createPurchase({
		listName: 'Limpieza',
		storeId: carrefourId,
		storeName: 'Carrefour Express',
		total: 18.2,
		userId: juan.id,
		createdAt: daysAgo(2),
		items: [
			{
				name: 'Detergente líquido',
				quantity: 1,
				unit: 'package',
				categoria: 'Droguería y limpieza'
			},
			{ name: 'Lejía', quantity: 2, unit: 'liter', categoria: 'Droguería y limpieza' },
			{ name: 'Estropajos', quantity: 1, unit: 'package', categoria: 'Droguería y limpieza' }
		]
	});
	// Una compra sin establecimiento y con la lista de origen ya borrada
	// (listId null): ejercita los SetNull y los nombres snapshotados.
	await createPurchase({
		listName: 'Compra semanal',
		total: 31.6,
		userId: maria.id,
		createdAt: daysAgo(14),
		items: [
			{ name: 'Yogur natural', quantity: 6, unit: 'unit', categoria: 'Lácteos y huevos' },
			{ name: 'Café molido', quantity: 250, unit: 'gram', categoria: 'Alimentación' },
			{ name: 'Arroz redondo', quantity: 1, unit: 'kilogram', categoria: 'Alimentación' }
		]
	});

	// ---------------------------------------------------------------------------
	// 7. Receta y menús (épica #232 y #212): la receta alimenta el menú por su
	//    `recipeId` (trazabilidad); los ingredientes van snapshotados
	// ---------------------------------------------------------------------------
	const aceitePantry = await prisma.pantryItem.findFirst({
		where: {
			organizationId: familia.id,
			normalizedName: normalizeItemName('Aceite de oliva virgen extra')
		},
		select: { id: true }
	});

	async function createRecipe(options: {
		name: string;
		servings: number;
		ingredients: Array<{
			name: string;
			quantity: number;
			unit: Unit;
			categoria?: string;
			pantryItemId?: string;
		}>;
	}): Promise<string> {
		const recipe = await prisma.recipe.create({
			data: {
				organizationId: familia.id,
				name: options.name,
				normalizedName: normalizeItemName(options.name),
				servings: options.servings,
				ingredients: {
					create: options.ingredients.map((ingredient, position) => ({
						position,
						name: ingredient.name,
						quantity: ingredient.quantity,
						unit: ingredient.unit,
						categoryId: ingredient.categoria ? cat(ingredient.categoria).id : null,
						pantryItemId: ingredient.pantryItemId ?? null
					}))
				}
			}
		});
		return recipe.id;
	}

	const recetaLentejas = await createRecipe({
		name: 'Lentejas con verduras',
		servings: 4,
		ingredients: [
			{ name: 'Lentejas pardinas', quantity: 500, unit: 'gram', categoria: 'Alimentación' },
			{ name: 'Cebolla', quantity: 2, unit: 'unit', categoria: 'Frutas y verduras' },
			{ name: 'Zanahoria', quantity: 3, unit: 'unit', categoria: 'Frutas y verduras' },
			{ name: 'Pimentón dulce', quantity: 1, unit: 'package', categoria: 'Alimentación' },
			{
				name: 'Aceite de oliva virgen extra',
				quantity: 50,
				unit: 'milliliter',
				categoria: 'Alimentación',
				pantryItemId: aceitePantry?.id
			}
		]
	});

	async function createMealPlan(options: {
		dateKey: string;
		mealType: MealType;
		title: string;
		recipeId?: string | null;
		ingredients: Array<{ name: string; quantity: number; unit: Unit; categoria?: string }>;
	}): Promise<void> {
		await prisma.mealPlan.create({
			data: {
				organizationId: familia.id,
				date: new Date(`${options.dateKey}T00:00:00Z`),
				mealType: options.mealType,
				title: options.title,
				recipeId: options.recipeId ?? null,
				ingredients: {
					create: options.ingredients.map((ingredient, position) => ({
						position,
						name: ingredient.name,
						quantity: ingredient.quantity,
						unit: ingredient.unit,
						categoryId: ingredient.categoria ? cat(ingredient.categoria).id : null
					}))
				}
			}
		});
	}

	await createMealPlan({
		dateKey: dateKey(0),
		mealType: 'lunch',
		title: 'Lentejas con verduras',
		recipeId: recetaLentejas,
		ingredients: [
			{ name: 'Lentejas pardinas', quantity: 500, unit: 'gram', categoria: 'Alimentación' },
			{ name: 'Cebolla', quantity: 2, unit: 'unit', categoria: 'Frutas y verduras' },
			{ name: 'Zanahoria', quantity: 3, unit: 'unit', categoria: 'Frutas y verduras' }
		]
	});
	await createMealPlan({
		dateKey: dateKey(0),
		mealType: 'dinner',
		title: 'Tortilla de patatas',
		ingredients: [
			{ name: 'Huevos', quantity: 6, unit: 'unit', categoria: 'Lácteos y huevos' },
			{ name: 'Patatas', quantity: 1, unit: 'kilogram', categoria: 'Frutas y verduras' }
		]
	});
	await createMealPlan({
		dateKey: dateKey(1),
		mealType: 'breakfast',
		title: 'Tostadas con tomate',
		ingredients: [
			{ name: 'Pan de molde', quantity: 2, unit: 'unit', categoria: 'Pan y pastelería' },
			{ name: 'Tomate maduro', quantity: 1, unit: 'unit', categoria: 'Frutas y verduras' }
		]
	});

	// ---------------------------------------------------------------------------
	// 8. Invitación pendiente (issue #60): como la deja `inviteFamily`
	// ---------------------------------------------------------------------------
	await prisma.invitation.create({
		data: {
			id: randomUUID(),
			token: randomUUID(),
			identifier: EMAIL_INVITADA,
			contextType: 'organization',
			contextId: familia.id,
			roleId: roles.member,
			invitedBy: maria.id,
			status: 'pending',
			expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
			createdAt: now
		}
	});

	// ---------------------------------------------------------------------------
	// Resumen
	// ---------------------------------------------------------------------------
	console.log(`✅ Seed completado: «${FAMILIA_NOMBRE}» (slug: ${FAMILIA_SLUG})`);
	console.log('');
	console.log(`   Admin:   ${USUARIO_ADMIN.email}`);
	console.log(`   Miembro: ${USUARIO_MIEMBRO.email}`);
	console.log(`   Invitación pendiente para ${EMAIL_INVITADA} (sin cuenta)`);
	console.log('');
	console.log(`   ${nombresCategorias.length} categorías, ${storeSeq} establecimientos`);
	console.log(
		`   3 listas con ${totalItems} items, ${pantrySeq} productos en la despensa, 3 compras en el historial`
	);
	console.log('   1 receta, 3 menús (hoy y mañana)');
	console.log('');
	console.log('   Para entrar: /login con uno de los emails — el código OTP sale en el');
	console.log('   log del dev server («email capturado (no enviado)»), no llega por correo.');
}

main()
	.catch((error) => {
		console.error('❌ El seed falló:', error);
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());
