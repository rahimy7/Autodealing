import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Agents never see a customer's full phone number, in any view — only the last 4 digits.
export function maskPhone(phone: string | null | undefined): string | null | undefined {
  if (!phone) return phone;
  return `•••• ${phone.slice(-4)}`;
}
