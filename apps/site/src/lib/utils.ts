import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Compose class names, letting later Tailwind classes override earlier ones (the coss/shadcn `cn`). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
