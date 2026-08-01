// Configurable currency symbol (P2 5.7). Defaults to the Philippine Peso.
// App.tsx loads the persisted 'currency' setting at startup and calls setCurrencySymbol.
let currencySymbol = '₱'

export function setCurrencySymbol(sym: string | null | undefined) {
  currencySymbol = sym && sym.trim() ? sym.trim() : '₱'
}

export function getCurrencySymbol(): string {
  return currencySymbol
}

/** Format a number as money using the configured currency symbol. */
export function formatMoney(n: number | string | null | undefined): string {
  const num = Number(n ?? 0)
  return `${currencySymbol}${num.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
