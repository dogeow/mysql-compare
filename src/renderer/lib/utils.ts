import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCellValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** 把表 row 转换为只含主键字段的对象，供 update/delete 用 */
export function pickPK(
  row: Record<string, unknown>,
  pk: string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of pk) out[k] = row[k]
  return out
}
