/**
 * Format a number with thousands separators and fixed decimal places.
 * @param {number|null|undefined} value
 * @param {number} decimals - fraction digits (default 2)
 * @returns {string} formatted number or "—"
 */
export function fmtNum(value, decimals = 2) {
  if (value == null || isNaN(value)) return "—";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
