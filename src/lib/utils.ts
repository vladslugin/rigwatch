import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combine class names with Tailwind-aware deduplication.
 * Used by every shadcn/ui component — keeps prop className overrides clean.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
