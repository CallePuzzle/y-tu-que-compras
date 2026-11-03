import Apple from '@lucide/svelte/icons/apple';
import Baby from '@lucide/svelte/icons/baby';
import Beef from '@lucide/svelte/icons/beef';
import Book from '@lucide/svelte/icons/book';
import Candy from '@lucide/svelte/icons/candy';
import Coffee from '@lucide/svelte/icons/coffee';
import Croissant from '@lucide/svelte/icons/croissant';
import Dog from '@lucide/svelte/icons/dog';
import Fish from '@lucide/svelte/icons/fish';
import Flower2 from '@lucide/svelte/icons/flower-2';
import Gift from '@lucide/svelte/icons/gift';
import House from '@lucide/svelte/icons/house';
import ListChecks from '@lucide/svelte/icons/list-checks';
import Pill from '@lucide/svelte/icons/pill';
import Pizza from '@lucide/svelte/icons/pizza';
import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
import Smartphone from '@lucide/svelte/icons/smartphone';
import WashingMachine from '@lucide/svelte/icons/washing-machine';
import Wine from '@lucide/svelte/icons/wine';
import Wrench from '@lucide/svelte/icons/wrench';
import { m } from '#lib/paraglide/messages.js';
import type { LIST_COLORS, LIST_ICONS } from '#lib/schemas/list.js';

/** Un color de la paleta dedicada de listas (catálogo `LIST_COLORS`). */
export type ListColor = (typeof LIST_COLORS)[number];

/** Un icono del catálogo lucide (catálogo `LIST_ICONS`). */
export type ListIcon = (typeof LIST_ICONS)[number];

/**
 * Catálogo de iconos: el nombre del schema es la ruta de import de lucide,
 * así que el mapa vive junto a los imports y el `satisfies` garantiza en
 * compilación que el catálogo entero está representado (un nombre sin
 * componente no se podría renderizar).
 */
export const ICONS = {
	// Genéricos
	'shopping-basket': ShoppingBasket,
	'list-checks': ListChecks,
	house: House,
	gift: Gift,
	// Comida y bebida
	apple: Apple,
	croissant: Croissant,
	beef: Beef,
	fish: Fish,
	wine: Wine,
	coffee: Coffee,
	pizza: Pizza,
	candy: Candy,
	// Hogar y demás
	baby: Baby,
	dog: Dog,
	pill: Pill,
	'washing-machine': WashingMachine,
	wrench: Wrench,
	smartphone: Smartphone,
	'flower-2': Flower2,
	book: Book
} as const satisfies Record<ListIcon, unknown>;

/**
 * Chip de color: el id de la paleta dedicada que guarda el schema traducido a
 * clases LITERALES — Tailwind no genera clases dinámicas (`bg-${color}` no
 * existe en el CSS compilado), así que la paleta completa se declara aquí.
 * Los pares `bg-list-<id> text-list-<id>-content` salen del bloque `@theme`
 * de `app.css` (contraste AA verificado par a par).
 */
export const COLOR_CHIP: Record<ListColor, string> = {
	red: 'bg-list-red text-list-red-content',
	orange: 'bg-list-orange text-list-orange-content',
	yellow: 'bg-list-yellow text-list-yellow-content',
	lime: 'bg-list-lime text-list-lime-content',
	green: 'bg-list-green text-list-green-content',
	teal: 'bg-list-teal text-list-teal-content',
	cyan: 'bg-list-cyan text-list-cyan-content',
	blue: 'bg-list-blue text-list-blue-content',
	purple: 'bg-list-purple text-list-purple-content',
	pink: 'bg-list-pink text-list-pink-content',
	brown: 'bg-list-brown text-list-brown-content',
	gray: 'bg-list-gray text-list-gray-content'
};

/**
 * Nombres traducidos de colores e iconos (#118): los ids del catálogo NUNCA
 * se muestran tal cual (ni en `aria-label`/`title`). Funciones y no
 * constantes: el mapa se construye EN RENDER, no en scope de módulo (regla
 * i18n de la librería). El `Record` exige el catálogo entero en compilación.
 */
export function colorLabels(): Record<ListColor, string> {
	return {
		red: m.list_color_red(),
		orange: m.list_color_orange(),
		yellow: m.list_color_yellow(),
		lime: m.list_color_lime(),
		green: m.list_color_green(),
		teal: m.list_color_teal(),
		cyan: m.list_color_cyan(),
		blue: m.list_color_blue(),
		purple: m.list_color_purple(),
		pink: m.list_color_pink(),
		brown: m.list_color_brown(),
		gray: m.list_color_gray()
	};
}

export function iconLabels(): Record<ListIcon, string> {
	return {
		'shopping-basket': m.list_icon_shopping_basket(),
		'list-checks': m.list_icon_list_checks(),
		house: m.list_icon_house(),
		gift: m.list_icon_gift(),
		apple: m.list_icon_apple(),
		croissant: m.list_icon_croissant(),
		beef: m.list_icon_beef(),
		fish: m.list_icon_fish(),
		wine: m.list_icon_wine(),
		coffee: m.list_icon_coffee(),
		pizza: m.list_icon_pizza(),
		candy: m.list_icon_candy(),
		baby: m.list_icon_baby(),
		dog: m.list_icon_dog(),
		pill: m.list_icon_pill(),
		'washing-machine': m.list_icon_washing_machine(),
		wrench: m.list_icon_wrench(),
		smartphone: m.list_icon_smartphone(),
		'flower-2': m.list_icon_flower_2(),
		book: m.list_icon_book()
	};
}
