import { createAuthMiddleware } from '../../../shared/auth.js';
import { getDb } from '../db.js';

export const { requireAuth } = createAuthMiddleware({ getDb });
