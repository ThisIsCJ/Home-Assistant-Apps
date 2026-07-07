import { getAdminUsers, everyoneIsAdmin } from '../config.js';

// Home Assistant's ingress proxy authenticates the user (via the HA frontend)
// and forwards identity headers to the add-on. We trust those headers because
// the add-on is only reachable through the Supervisor ingress proxy.
//
//   X-Remote-User-Id            → stable HA user id (uuid)
//   X-Remote-User-Name          → username
//   X-Remote-User-Display-Name  → friendly name
//
// When accessed directly (e.g. local dev without ingress) we fall back to a
// single local identity so the app stays usable.
export function ingressUser(req, _res, next) {
  const id = req.get('X-Remote-User-Id') || 'local';
  const username = req.get('X-Remote-User-Name') || '';
  const displayName = req.get('X-Remote-User-Display-Name') || '';
  const name = displayName || username || 'Home Assistant User';

  const admins = getAdminUsers();
  const isAdmin =
    everyoneIsAdmin() ||
    admins.includes(username.toLowerCase()) ||
    admins.includes(displayName.toLowerCase());

  req.user = {
    id,
    name,
    email: '',
    // The recipe/review routes look at `isAdmin` to decide edit rights.
    isAdmin,
  };

  next();
}
