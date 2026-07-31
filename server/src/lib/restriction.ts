import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { isFinanciallyRestricted } from './settlement';

// Narrow, deliberate guard — blocks only creation of NEW discretionary spend (peer transfer, a
// brand-new Pay Later due, a brand-new online shop purchase) for a financially restricted
// student. Never applied to any route that pays down an EXISTING due (semester fee, library
// fine, admin fine, or an already-created Pay Later due) — those must keep working exactly as
// today, both because that's how a student clears the restriction and because the spec requires
// individual Shop/Library/Admin-fine payment to never be blocked.
export async function blockIfFinanciallyRestricted(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'Student') return next();

  try {
    const status = await isFinanciallyRestricted(req.user.id);
    if (status.restricted) {
      return res.status(403).json({
        message: 'Your account is financially restricted due to an overdue Semester Fee payment. Please settle your outstanding dues from the Dues & Settlement page to restore full access.',
        financiallyRestricted: true,
        reason: status.reason,
        overdueFees: status.overdueFees,
      });
    }
    next();
  } catch (err) {
    // Fail open on an infrastructure error here — a DB hiccup on this check must never itself
    // become the reason a paying-in-good-standing student gets blocked from transferring money.
    console.error('[blockIfFinanciallyRestricted] check failed:', err);
    next();
  }
}
