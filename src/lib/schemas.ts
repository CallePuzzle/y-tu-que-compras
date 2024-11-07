import { z } from 'zod';
import type { GroceryList, Grocery } from '@prisma/client';

const UserSchema = z.object({
	name: z.string().min(3),
	picture: z.string().url()
});

export { UserSchema };

const HomeSchema = z.object({
	name: z.string().min(3),
	description: z.string().min(3),
	icon: z.string()
});

export { HomeSchema };

const GrocerySchema = z.object({
	name: z.string().min(1),
	description: z.string().optional()
});

const GrocerySchemaWithId = GrocerySchema.extend({
	id: z.number().int()
});

export { GrocerySchema, GrocerySchemaWithId };

const GroceryListSchema = z.object({
	quantity: z.number().int().default(1),
	completed: z.boolean().default(false),
	groceryId: z.number().int()
});

export { GroceryListSchema };

const ListSchema = z.object({
	name: z.string()
});

const ListSchemaWithId = ListSchema.extend({
	id: z.number().int()
});

export { ListSchema, ListSchemaWithId };

const IdSchema = z.object({
	id: z.number().int()
});

const CompletedSchemaWithId = IdSchema.extend({
	completed: z.boolean()
});

export { IdSchema, CompletedSchemaWithId };

type GroceryListExtended = GroceryList & {
	grocery: Grocery;
};

export type { GroceryListExtended };
