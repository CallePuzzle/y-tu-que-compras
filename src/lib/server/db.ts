// import { getDB } from 'storybook-svelte/server';
import { DATABASE_URL } from '$env/static/private';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const adapter = new PrismaPg({ DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export default prisma;
