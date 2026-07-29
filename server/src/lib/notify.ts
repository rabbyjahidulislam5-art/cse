import prisma from './prisma';
import { sendEmail } from './email';
import { emitToUser } from './disputes/realtimeBus';

interface NotifyInput {
  recipientId: string;
  category: string;
  type: string;
  title: string;
  body: string;
  /** Deep link into the frontend, e.g. "/student/ledger" — opened when the notification is clicked. */
  link?: string;
  /** If set, also best-effort emails the recipient (failure never blocks the caller). */
  emailSubject?: string;
  /** Richer HTML for the email body; falls back to `body` (plain text) if omitted. */
  emailBody?: string;
}

export async function notifyUser(input: NotifyInput): Promise<void> {
  const row = await prisma.notification.create({
    data: {
      recipientId: input.recipientId,
      category: input.category,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
    },
  });

  emitToUser(input.recipientId, 'notification:new', {
    id: row.id, category: row.category, type: row.type, title: row.title, body: row.body,
    link: row.link, createdAt: row.createdAt, read: false,
  });

  if (input.emailSubject) {
    // Fire-and-forget: the Gmail API round trip (~2-3s) must never make the caller's HTTP
    // response wait on it — matches the same convention used by disputes/notify.ts.
    void (async () => {
      try {
        const recipient = await prisma.user.findUnique({ where: { id: input.recipientId } });
        if (recipient?.email) {
          await sendEmail(recipient.email, input.emailSubject!, [
            { type: 'text', content: `<strong>Hi ${recipient.fullName || 'there'},</strong>\n\n${input.emailBody || input.body}` },
            { type: 'divider' },
            { type: 'text', content: '🎓 Smart Campus' },
          ]);
        }
      } catch { /* best-effort, matches the rest of the app's email-failure convention */ }
    })();
  }
}

// Fans a notification out to every user in a role (e.g. every Library staff account).
export async function notifyRole(role: string, input: Omit<NotifyInput, 'recipientId'>): Promise<void> {
  const staff = await prisma.user.findMany({ where: { role }, select: { id: true } });
  await Promise.all(staff.map(s => notifyUser({ ...input, recipientId: s.id })));
}
