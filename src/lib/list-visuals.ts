import Apple from '@lucide/svelte/icons/apple';
import Baby from '@lucide/svelte/icons/baby';
import Beef from '@lucide/svelte/icons/beef';
import Beer from '@lucide/svelte/icons/beer';
import Book from '@lucide/svelte/icons/book';
import Candy from '@lucide/svelte/icons/candy';
import Carrot from '@lucide/svelte/icons/carrot';
import Cat from '@lucide/svelte/icons/cat';
import ClipboardList from '@lucide/svelte/icons/clipboard-list';
import Coffee from '@lucide/svelte/icons/coffee';
import Croissant from '@lucide/svelte/icons/croissant';
import CupSoda from '@lucide/svelte/icons/cup-soda';
import Dog from '@lucide/svelte/icons/dog';
import Egg from '@lucide/svelte/icons/egg';
import Fish from '@lucide/svelte/icons/fish';
import Flower2 from '@lucide/svelte/icons/flower-2';
import Gamepad2 from '@lucide/svelte/icons/gamepad-2';
import Gift from '@lucide/svelte/icons/gift';
import Hammer from '@lucide/svelte/icons/hammer';
import Heart from '@lucide/svelte/icons/heart';
import House from '@lucide/svelte/icons/house';
import Laptop from '@lucide/svelte/icons/laptop';
import Leaf from '@lucide/svelte/icons/leaf';
import ListChecks from '@lucide/svelte/icons/list-checks';
import Milk from '@lucide/svelte/icons/milk';
import Music from '@lucide/svelte/icons/music';
import Paintbrush from '@lucide/svelte/icons/paintbrush';
import Pill from '@lucide/svelte/icons/pill';
import Pizza from '@lucide/svelte/icons/pizza';
import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
import ShoppingBasket from '@lucide/svelte/icons/shopping-basket';
import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
import Smartphone from '@lucide/svelte/icons/smartphone';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Star from '@lucide/svelte/icons/star';
import Ticket from '@lucide/svelte/icons/ticket';
import WashingMachine from '@lucide/svelte/icons/washing-machine';
import Wine from '@lucide/svelte/icons/wine';
import Wrench from '@lucide/svelte/icons/wrench';
import { m } from '$lib/paraglide/messages.js';
import type { LIST_COLORS, LIST_ICONS } from '$lib/schemas/list.js';

/** Un color de la paleta daisyUI (catálogo `LIST_COLORS`). */
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
	'list-checks': ListChecks,
	'clipboard-list': ClipboardList,
	'shopping-basket': ShoppingBasket,
	'shopping-cart': ShoppingCart,
	'shopping-bag': ShoppingBag,
	star: Star,
	heart: Heart,
	sparkles: Sparkles,
	gift: Gift,
	ticket: Ticket,
	house: House,
	// Comida y bebida
	apple: Apple,
	carrot: Carrot,
	croissant: Croissant,
	egg: Egg,
	fish: Fish,
	beef: Beef,
	milk: Milk,
	pizza: Pizza,
	candy: Candy,
	coffee: Coffee,
	beer: Beer,
	wine: Wine,
	'cup-soda': CupSoda,
	// Hogar y demás
	baby: Baby,
	dog: Dog,
	cat: Cat,
	pill: Pill,
	leaf: Leaf,
	'flower-2': Flower2,
	paintbrush: Paintbrush,
	wrench: Wrench,
	hammer: Hammer,
	'washing-machine': WashingMachine,
	laptop: Laptop,
	smartphone: Smartphone,
	'gamepad-2': Gamepad2,
	book: Book,
	music: Music
} as const satisfies Record<ListIcon, unknown>;

/**
 * Chip de color: el nombre daisyUI que guarda el schema traducido a clases
 * LITERALES — Tailwind no genera clases dinámicas (`bg-${color}` no existe
 * en el CSS compilado), así que la paleta completa se declara aquí.
 */
export const COLOR_CHIP: Record<ListColor, string> = {
	primary: 'bg-primary text-primary-content',
	secondary: 'bg-secondary text-secondary-content',
	accent: 'bg-accent text-accent-content',
	neutral: 'bg-neutral text-neutral-content',
	info: 'bg-info text-info-content',
	success: 'bg-success text-success-content',
	warning: 'bg-warning text-warning-content',
	error: 'bg-error text-error-content'
};

/**
 * Nombres traducidos de colores e iconos (#118): los ids del catálogo NUNCA
 * se muestran tal cual (ni en `aria-label`/`title`). Funciones y no
 * constantes: el mapa se construye EN RENDER, no en scope de módulo (regla
 * i18n de la librería). El `Record` exige el catálogo entero en compilación.
 */
export function colorLabels(): Record<ListColor, string> {
	return {
		primary: m.list_color_primary(),
		secondary: m.list_color_secondary(),
		accent: m.list_color_accent(),
		neutral: m.list_color_neutral(),
		info: m.list_color_info(),
		success: m.list_color_success(),
		warning: m.list_color_warning(),
		error: m.list_color_error()
	};
}

export function iconLabels(): Record<ListIcon, string> {
	return {
		'list-checks': m.list_icon_list_checks(),
		'clipboard-list': m.list_icon_clipboard_list(),
		'shopping-basket': m.list_icon_shopping_basket(),
		'shopping-cart': m.list_icon_shopping_cart(),
		'shopping-bag': m.list_icon_shopping_bag(),
		star: m.list_icon_star(),
		heart: m.list_icon_heart(),
		sparkles: m.list_icon_sparkles(),
		gift: m.list_icon_gift(),
		ticket: m.list_icon_ticket(),
		house: m.list_icon_house(),
		apple: m.list_icon_apple(),
		carrot: m.list_icon_carrot(),
		croissant: m.list_icon_croissant(),
		egg: m.list_icon_egg(),
		fish: m.list_icon_fish(),
		beef: m.list_icon_beef(),
		milk: m.list_icon_milk(),
		pizza: m.list_icon_pizza(),
		candy: m.list_icon_candy(),
		coffee: m.list_icon_coffee(),
		beer: m.list_icon_beer(),
		wine: m.list_icon_wine(),
		'cup-soda': m.list_icon_cup_soda(),
		baby: m.list_icon_baby(),
		dog: m.list_icon_dog(),
		cat: m.list_icon_cat(),
		pill: m.list_icon_pill(),
		leaf: m.list_icon_leaf(),
		'flower-2': m.list_icon_flower_2(),
		paintbrush: m.list_icon_paintbrush(),
		wrench: m.list_icon_wrench(),
		hammer: m.list_icon_hammer(),
		'washing-machine': m.list_icon_washing_machine(),
		laptop: m.list_icon_laptop(),
		smartphone: m.list_icon_smartphone(),
		'gamepad-2': m.list_icon_gamepad_2(),
		book: m.list_icon_book(),
		music: m.list_icon_music()
	};
}
