// import { getDB } from 'storybook-svelte/server';
import { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } from '$env/static/private';

import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';

import type { Config } from '@libsql/core/api';

function getDB(TURSO_DATABASE_URL: string, TURSO_AUTH_TOKEN: string): PrismaClient {
	const config: Config = {
		url: TURSO_DATABASE_URL,
		authToken: TURSO_AUTH_TOKEN
	};

	const adapter = new PrismaLibSQL(config);
	return new PrismaClient({ adapter });
}

const db = getDB(TURSO_DATABASE_URL, TURSO_AUTH_TOKEN);
export default db;
