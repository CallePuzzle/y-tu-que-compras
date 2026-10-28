import { describe, expect, it } from 'vitest';
import { radioTarget } from './radio-group.js';

describe('radioTarget', () => {
	it('→ y ↓ van a la siguiente, circular', () => {
		expect(radioTarget('ArrowRight', 0, 3)).toBe(1);
		expect(radioTarget('ArrowDown', 2, 3)).toBe(0);
	});

	it('← y ↑ van a la anterior, circular', () => {
		expect(radioTarget('ArrowLeft', 1, 3)).toBe(0);
		expect(radioTarget('ArrowUp', 0, 3)).toBe(2);
	});

	it('Inicio y Fin van a los extremos', () => {
		expect(radioTarget('Home', 2, 3)).toBe(0);
		expect(radioTarget('End', 0, 3)).toBe(2);
	});

	it('el resto de teclas no navegan', () => {
		expect(radioTarget('Enter', 1, 3)).toBeNull();
		expect(radioTarget('a', 1, 3)).toBeNull();
	});
});
