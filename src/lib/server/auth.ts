import db from './db';
// import sender from './sender';
import { getAuth } from 'storybook-svelte/server';
import { prismaAdapter } from 'better-auth/adapters/prisma';

const database = prismaAdapter(db, {
	provider: 'postgresql'
});

export const auth = getAuth(database);
