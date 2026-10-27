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
