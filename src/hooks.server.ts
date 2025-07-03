import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { betterAuth } from 'storybook-svelte';
import { auth } from './lib/server/auth.js';

export const handle: Handle = sequence(betterAuth(auth));
