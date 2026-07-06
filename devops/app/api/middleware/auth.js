import { createAuthMiddleware } from '../../shared/auth.js';
import { getDb } from '../db.js';

// The api service is the one that persists authenticated users to the DB.
export const { requireAuth, invalidateAuthProviderCache } =
  createAuthMiddleware({ getDb, persistUsers: true });
