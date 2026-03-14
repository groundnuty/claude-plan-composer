import { z } from "zod";

export const DiversityResultSchema = z.object({
  jaccardDistance: z.number().min(0).max(1),
  shannonEntropy: z.object({
    perNgram: z.record(z.string(), z.number()),
    mean: z.number(),
  }),
  normalizedEntropy: z.number().min(0).max(1),
  compositeScore: z.number().min(0).max(1),
  warning: z.string().optional(),
});

export type DiversityResult = z.infer<typeof DiversityResultSchema>;
