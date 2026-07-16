import { z } from "zod";

const clean = (value: unknown) => typeof value === "string" ? value.trim() : value;
const text = (min: number, max: number) => z.preprocess(clean, z.string().min(min).max(max));
const httpsUrl = z.string().url().refine((url) => url.startsWith("https://"), "Use uma URL https://");

export const loginSchema = z.object({
  email: z.preprocess(clean, z.string().email("Informe um e-mail válido.").max(254)),
  password: z.string().min(8, "A senha deve ter ao menos 8 caracteres.").max(128),
});

export const propertySchema = z.object({
  cityId: z.string().uuid().optional().or(z.literal("")),
  title: text(3, 120), description: text(10, 2000), neighborhood: text(2, 120), street: text(2, 160),
  addressNumber: z.preprocess(clean, z.string().max(30)).optional(),
  addressComplement: z.preprocess(clean, z.string().max(120)).optional(),
  rent: z.number().nonnegative(), iptu: z.number().nonnegative().optional(), water: z.number().nonnegative().optional(),
  internet: z.number().nonnegative().optional(), condoFee: z.number().nonnegative().optional(), area: z.number().positive().optional(),
  rooms: z.number().int().min(1).max(50), bathrooms: z.number().int().min(1).max(50), vacancies: z.number().int().min(1).max(50),
  furnished: z.boolean(), petsAllowed: z.boolean(), available: z.boolean(),
  photos: z.array(httpsUrl).min(1).max(20), amenities: z.array(text(1, 80)).max(30), rules: z.array(text(1, 160)).max(30),
  type: z.enum(["apartment", "house", "studio", "room", "sharedRoom", "kitnet"]),
  contactLink: httpsUrl.optional().or(z.literal("")),
});

export type PropertyInput = z.infer<typeof propertySchema>;
