// SLA due-date math for dispute cases. Deliberately simple (no external scheduler/cron): the due
// date is just a DateTime column compared against `now()` wherever it's read (dashboards, badges),
// so there is nothing to keep running — it's correct even if the server restarts or Render's free
// tier spins the instance down and back up.

const DEFAULT_SLA_HOURS = 72;

export function computeSlaDueAt(from: Date = new Date(), hours: number = DEFAULT_SLA_HOURS): Date {
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}

export function isSlaBreached(slaDueAt: Date | null | undefined, frozen: boolean): boolean {
  if (!slaDueAt || frozen) return false;
  return Date.now() > slaDueAt.getTime();
}

// "Freeze Review" pauses the SLA clock rather than letting the deadline silently pass while a case
// is under deeper investigation. There's no separate "remaining time" column — unfreezing simply
// pushes the existing due date forward by exactly how long the case sat frozen, which is
// equivalent and needs no extra schema.
export function extendSlaByFreezeDuration(slaDueAt: Date | null, frozenAt: Date | null): Date | null {
  if (!slaDueAt || !frozenAt) return slaDueAt;
  const frozenDurationMs = Date.now() - frozenAt.getTime();
  return new Date(slaDueAt.getTime() + Math.max(0, frozenDurationMs));
}
