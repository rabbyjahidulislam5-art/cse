// Utility functions for Smart Campus
export function formatCurrency(amount: number): string {
  return `৳ ${amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatShortDate(dateStr: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDueDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = d.getUTCDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

export const CATEGORY_LABELS: Record<string, string> = {
  'Food & Beverage': 'Food & Beverage',
  'Stationery': 'Stationery',
  'Printing': 'Printing',
  'Other': 'Other',
  food_beverage: 'Food & Beverage',
  stationery: 'Stationery',
  printing: 'Printing',
  other: 'Other',
};

export const TYPE_LABELS: Record<string, string> = {
  'Deposit': 'Deposit',
  'Shop Payment': 'Shop Payment',
  'Fine Payment': 'Fine Payment',
  'Fee Payment': 'Fee Payment',
  'Transfer Sent': 'Transfer Sent',
  'Transfer Received': 'Transfer Received',
  'Refund': 'Refund',
  'Mass Payment': 'Mass Payment',
  'Top Up': 'Top Up',
  'Withdrawal': 'Withdrawal',
};
