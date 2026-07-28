import prisma from '../prisma';
import { sendEmail } from '../email';
import { emitToUser } from './realtimeBus';

interface NotifyInput {
  disputeId?: string;
  recipientId: string;
  type: string;
  title: string;
  body: string;
  /** If set, also best-effort emails the recipient (failure never blocks the caller). */
  emailSubject?: string;
}

export async function notify(input: NotifyInput): Promise<void> {
  const row = await prisma.disputeNotification.create({
    data: { disputeId: input.disputeId, recipientId: input.recipientId, type: input.type, title: input.title, body: input.body },
  });

  emitToUser(input.recipientId, 'dispute:notification', {
    id: row.id, disputeId: row.disputeId, type: row.type, title: row.title, body: row.body, createdAt: row.createdAt,
  });

  if (input.emailSubject) {
    // Fire-and-forget: the Gmail API round trip (~2-3s) must never make the caller's HTTP
    // response — and therefore every reply/refund/status-change button in the UI — wait on it.
    // Still best-effort (a failed send never surfaces to the caller), matching the rest of the
    // app's email-failure convention; this only decouples latency, not error handling.
    void (async () => {
      try {
        const recipient = await prisma.user.findUnique({ where: { id: input.recipientId } });
        if (recipient?.email) {
          await sendEmail(recipient.email, input.emailSubject!, [
            { type: 'text', content: `<strong>Hi ${recipient.fullName || 'there'},</strong>\n\n${input.body}` },
            { type: 'divider' },
            { type: 'text', content: '🎓 Smart Campus — Financial Disputes' },
          ]);
        }
      } catch { /* best-effort, matches the rest of the app's email-failure convention */ }
    })();
  }
}

// Fans a notification out to every user in a role (e.g. every Accounts Office staff account) —
// there's no single "the Accounts Office user", so a new case notifies the whole role.
export async function notifyRole(role: string, input: Omit<NotifyInput, 'recipientId'>): Promise<void> {
  const staff = await prisma.user.findMany({ where: { role }, select: { id: true } });
  await Promise.all(staff.map(s => notify({ ...input, recipientId: s.id })));
}
