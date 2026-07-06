import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { RequireAuth, useAuth } from './auth/AuthProvider.jsx';
import { AuthCallback } from './auth/AuthCallback.jsx';
import { AuthSilentCallback } from './auth/AuthSilentCallback.jsx';
import { Shell } from './components/Shell.jsx';
import { Tour } from './components/Tour.jsx';

import { Login }          from './pages/Login.jsx';
import { Dashboard }      from './pages/Dashboard.jsx';
import { NewRequest }     from './pages/NewRequest.jsx';
import { RequestHistory } from './pages/RequestHistory.jsx';
import { RequestDetails } from './pages/RequestDetails.jsx';
import { Status }         from './pages/Status.jsx';
import { Team }           from './pages/Team.jsx';
import { Profile }        from './pages/Profile.jsx';
import { Setup }          from './pages/setup/Setup.jsx';

import { AdminOverview }  from './pages/admin/AdminOverview.jsx';
import { Branding }       from './pages/admin/Branding.jsx';
import { Authentication } from './pages/admin/Authentication.jsx';
import { Database }       from './pages/admin/Database.jsx';
import { Domains }        from './pages/admin/Domains.jsx';
import { Hosts }          from './pages/admin/Hosts.jsx';
import { AdminUsers }     from './pages/admin/AdminUsers.jsx';
import { AdminTeams }     from './pages/admin/AdminTeams.jsx';
import { Integrations }   from './pages/admin/Integrations.jsx';
import { Runs }           from './pages/admin/Runs.jsx';
import { Audit }          from './pages/admin/Audit.jsx';
import { Discovery }      from './pages/admin/Discovery.jsx';

const PATH_TITLES = {
  '/app':                   'Dashboard',
  '/app/requests/new':      'New Site Request',
  '/app/requests':          'Request History',
  '/app/status':            'Site Status',
  '/app/team':              'Team Access',
  '/app/profile':           'Profile',
  '/admin':                 'Admin Overview',
  '/admin/branding':        'Branding',
  '/admin/authentication':  'Authentication',
  '/admin/database':        'Database',
  '/admin/domains':         'Domains',
  '/admin/hosts':           'Hosts',
  '/admin/users':           'Users',
  '/admin/teams':           'Teams',
  '/admin/integrations':    'Integrations',
  '/admin/runs':            'Automation Runs',
  '/admin/audit':           'Audit Log',
  '/admin/discovery':       'Discovery',
};

function usePageTitle() {
  const { pathname } = useLocation();
  if (PATH_TITLES[pathname]) return PATH_TITLES[pathname];
  if (pathname.startsWith('/app/requests/')) return 'Request Details';
  return '';
}

function AppLayout() {
  const title = usePageTitle();
  return (
    <RequireAuth>
      <Shell title={title}><Outlet /></Shell>
      <Tour />
    </RequireAuth>
  );
}

function AdminLayout() {
  const title = usePageTitle();
  return (
    <RequireAuth adminOnly>
      <Shell title={title}><Outlet /></Shell>
    </RequireAuth>
  );
}

// In Home Assistant ingress mode the login and setup flows don't apply —
// HA authenticates users and the database is preconfigured.
function PublicOnly({ children }) {
  const { appConfig, loading } = useAuth();
  if (loading || !appConfig) return null;
  if (appConfig.haIngress) return <Navigate to="/app" replace />;
  return children;
}

function RootRedirect() {
  const { appConfig, loading } = useAuth();
  if (loading || !appConfig) return null;
  // Home Assistant ingress: HA already signed the user in and the bundled
  // database is preconfigured — go straight to the dashboard.
  if (appConfig.haIngress) {
    return <Navigate to="/app" replace />;
  }
  if (!appConfig.onboardingComplete || appConfig.authProviders.length === 0) {
    return <Navigate to="/setup" replace />;
  }
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/"              element={<RootRedirect />} />
      <Route path="/login"         element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/setup"         element={<PublicOnly><Setup /></PublicOnly>} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/auth/silent"   element={<AuthSilentCallback />} />

      {/* User portal */}
      <Route element={<AppLayout />}>
        <Route path="/app"              element={<Dashboard />} />
        <Route path="/app/requests/new" element={<NewRequest />} />
        <Route path="/app/requests"     element={<RequestHistory />} />
        <Route path="/app/requests/:id" element={<RequestDetails />} />
        <Route path="/app/status"       element={<Status />} />
        <Route path="/app/team"         element={<Team />} />
        <Route path="/app/profile"      element={<Profile />} />
        <Route path="/app/settings"     element={<Navigate to="/app/profile" replace />} />
      </Route>

      {/* Admin portal */}
      <Route element={<AdminLayout />}>
        <Route path="/admin"                 element={<AdminOverview />} />
        <Route path="/admin/branding"        element={<Branding />} />
        <Route path="/admin/authentication"  element={<Authentication />} />
        <Route path="/admin/database"        element={<Database />} />
        <Route path="/admin/domains"         element={<Domains />} />
        <Route path="/admin/hosts"           element={<Hosts />} />
        <Route path="/admin/users"           element={<AdminUsers />} />
        <Route path="/admin/teams"           element={<AdminTeams />} />
        <Route path="/admin/integrations"    element={<Integrations />} />
        <Route path="/admin/runs"            element={<Runs />} />
        <Route path="/admin/audit"           element={<Audit />} />
        <Route path="/admin/discovery"       element={<Discovery />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
