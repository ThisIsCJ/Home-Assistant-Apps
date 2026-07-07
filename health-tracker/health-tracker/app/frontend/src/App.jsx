import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './auth/AuthProvider';
import AuthCallback from './auth/AuthCallback';
import Shell from './components/Shell';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Food from './pages/Food';
import Medications from './pages/Medications';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import Placeholder from './pages/Placeholder';
import HealthStats from './pages/HealthStats';
import Workouts from './pages/Workouts';
import Calendar from './pages/Calendar';
import { Icons } from './components/Icons';
import Reminders from './pages/Reminders';
import Reports from './pages/Reports';
import HealthImport from './pages/HealthImport';
import Admin from './pages/Admin';
import ReminderManager from './components/ReminderManager';
import { AppFeedbackProvider } from './components/AppFeedback';

function ProtectedPage({ children }) {
  return (
    <RequireAuth>
      <Shell>{children}</Shell>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppFeedbackProvider>
        <ReminderManager />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          <Route path="/" element={<ProtectedPage><Dashboard /></ProtectedPage>} />
          <Route path="/food" element={<ProtectedPage><Food /></ProtectedPage>} />
          <Route path="/profile" element={<ProtectedPage><Profile /></ProtectedPage>} />
          <Route path="/settings" element={<ProtectedPage><Settings /></ProtectedPage>} />
          <Route path="/medications" element={<ProtectedPage><Medications /></ProtectedPage>} />
          <Route path="/health" element={<ProtectedPage><HealthStats /></ProtectedPage>} />
          <Route path="/workouts" element={<ProtectedPage><Workouts /></ProtectedPage>} />
          <Route path="/calendar" element={<ProtectedPage><Calendar /></ProtectedPage>} />
          <Route path="/reminders" element={<ProtectedPage><Reminders /></ProtectedPage>} />
          <Route path="/reports"       element={<ProtectedPage><Reports /></ProtectedPage>} />
          <Route path="/health-import" element={<ProtectedPage><HealthImport /></ProtectedPage>} />
          <Route path="/admin" element={<ProtectedPage><Admin /></ProtectedPage>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppFeedbackProvider>
    </AuthProvider>
  );
}
