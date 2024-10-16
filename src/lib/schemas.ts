import { z } from 'zod';

const UserSchema = z.object({
	name: z.string().min(3),
	picture: z.string().url()
});

export { UserSchema };

const HomeSchema = z.object({
	name: z.string().min(3),
	description: z.string().min(3)
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
	name: z.string(),
	completed: z.boolean().default(false),
	groceries: z.array(z.number().int())
});

export { ListSchema };
