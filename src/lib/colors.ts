export type ColorName = 'gray' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink'

export const COLOR_NAMES: ColorName[] = ['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']

export const COLOR_PALETTE: Record<ColorName, { bg: string; fg: string; swatch: string }> = {
  gray:   { bg: '#f0f0f0', fg: '#5b5b5b', swatch: '#9b9b9b' },
  red:    { bg: '#fae0e0', fg: '#9b2c2c', swatch: '#e15c5c' },
  orange: { bg: '#fff3e0', fg: '#b45309', swatch: '#f59e0b' },
  yellow: { bg: '#fff9c4', fg: '#9e6c00', swatch: '#eab308' },
  green:  { bg: '#e6f4ea', fg: '#1e7e34', swatch: '#22c55e' },
  blue:   { bg: '#e0f0fe', fg: '#1c64a3', swatch: '#3b82f6' },
  purple: { bg: '#f0e6fa', fg: '#7c3aed', swatch: '#a855f7' },
  pink:   { bg: '#fde8f0', fg: '#be185d', swatch: '#ec4899' },
}

export type DropdownOption = { value: string; color: ColorName }

export function colorStyleFor(color: ColorName | undefined) {
  const c = COLOR_PALETTE[color ?? 'gray']
  return { backgroundColor: c.bg, color: c.fg }
}
