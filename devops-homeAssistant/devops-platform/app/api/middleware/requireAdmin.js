import { createRequireAdmin } from '../../shared/requireAdmin.js';
import { getDb } from '../db.js';

export const { requireAdmin, invalidateAdminGroupCache } = createRequireAdmin({ getDb });
