import { z } from 'zod';

const homeSchema = z.object({
    name: z.string().min(3),
    description: z.string().min(3),
});

export { homeSchema };