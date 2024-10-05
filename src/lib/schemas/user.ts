import { z } from 'zod';

const userSchema = z.object({
	name: z.string().min(3),
	picture: z.string().url()
});

export { userSchema };
