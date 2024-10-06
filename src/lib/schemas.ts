import { z } from 'zod';

const UserSchema = z.object({
	name: z.string().min(3),
	picture: z.string().url()
});

const HomeSchema = z.object({
	name: z.string().min(3),
	description: z.string().min(3)
});

const PriceSchema = z.object({
	id: z.number().int(),
	price: z.number().min(0),
	date: z.date(),
	grocery_id: z.number().int(),
	store_id: z.number().int()
});

const StoreSchema = z.object({
	id: z.number().int(),
	name: z.string().min(1),
	description: z.string().optional(),
	Price: z.array(PriceSchema)
});

const GrocerySchema = z.object({
	name: z.string().min(1),
	description: z.string().optional()
});

const GrocerySchemaWithId = GrocerySchema.extend({
	id: z.number().int()
});

export { UserSchema, HomeSchema, PriceSchema, StoreSchema, GrocerySchema, GrocerySchemaWithId };
