import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from './prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'smart-campus-jwt-secret-change-me';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    fullName?: string;
    role?: string;
    studentId?: string;
    department?: string;
    batch?: string;
    phone?: string;
    status?: string;
    pinSet?: boolean;
    pinLength?: number;
    mustChangePassword?: boolean;
    emailVerified?: boolean;
    [key: string]: unknown;
  };
}

export function generateToken(user: { id: string; email: string; role?: string }): string {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string };
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) return res.status(401).json({ message: 'User not found' });

    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName || undefined,
      firstName: user.fullName?.split(' ')[0],
      role: user.role || undefined,
      studentId: user.studentId || undefined,
      department: user.department || undefined,
      batch: user.batch || undefined,
      phone: user.phone || undefined,
      status: user.status || undefined,
      pinSet: user.pinSet || false,
      pinLength: user.pinLength || 4,
      mustChangePassword: user.mustChangePassword || false,
      emailVerified: user.emailVerified || false,
    };
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// Role gate — must run after authMiddleware. Every /admin/*, /library/*, /accounts/*, and
// shop-staff-dashboard route needs this; without it, any authenticated account (including a
// student) can call staff-only endpoints since authMiddleware alone only checks "is logged in".
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role || '')) {
      return res.status(403).json({ message: 'You do not have permission to perform this action.' });
    }
    next();
  };
}
