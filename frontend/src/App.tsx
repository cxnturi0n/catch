import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { LanguageProvider } from './i18n/LanguageContext'
import { AuthProvider } from './context/AuthContext'
import { TimezoneProvider } from './context/TimezoneContext'
import { WorkspaceProvider } from './context/WorkspaceContext'
import { ToastProvider } from './context/ToastContext'
import { ProtectedRoute, RedirectIfAuthenticated } from './components/auth/ProtectedRoute'
import { MainLayout } from './components/layout/MainLayout'
import { ConsentBanner } from './components/ConsentBanner'
import { EnvBanner } from './components/EnvBanner'

const Landing = lazy(() => import('./pages/Landing').then((m) => ({ default: m.Landing })))
const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })))
const Signup = lazy(() => import('./pages/Signup').then((m) => ({ default: m.Signup })))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword').then((m) => ({ default: m.ForgotPassword })))
const ResetPassword = lazy(() => import('./pages/ResetPassword').then((m) => ({ default: m.ResetPassword })))
const Onboarding = lazy(() => import('./pages/Onboarding').then((m) => ({ default: m.Onboarding })))
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })))
const Security = lazy(() => import('./pages/Security').then((m) => ({ default: m.Security })))
const TwoFactor = lazy(() => import('./pages/TwoFactor').then((m) => ({ default: m.TwoFactor })))
const VerifyEmail = lazy(() => import('./pages/VerifyEmail').then((m) => ({ default: m.VerifyEmail })))
const Members = lazy(() => import('./pages/Members').then((m) => ({ default: m.Members })))
const AcceptInvite = lazy(() => import('./pages/AcceptInvite').then((m) => ({ default: m.AcceptInvite })))
// Public discovery form, deliberately NOT wrapped in ProtectedRoute/MainLayout.
const DiscoveryForm = lazy(() => import('./pages/discovery/DiscoveryForm').then((m) => ({ default: m.DiscoveryForm })))

const CatchAI = lazy(() => import('./components/modules/CatchAI').then((m) => ({ default: m.CatchAI })))
const Analytics = lazy(() => import('./components/modules/Analytics').then((m) => ({ default: m.Analytics })))
const Listening = lazy(() => import('./components/modules/Listening').then((m) => ({ default: m.Listening })))
const Moderators = lazy(() => import('./components/modules/Moderators').then((m) => ({ default: m.Moderators })))
const KOLTracker = lazy(() => import('./components/modules/KOLTracker').then((m) => ({ default: m.KOLTracker })))
const Tasks = lazy(() => import('./components/modules/Tasks').then((m) => ({ default: m.Tasks })))
const Payments = lazy(() => import('./components/modules/Payments').then((m) => ({ default: m.Payments })))
const Report = lazy(() => import('./components/modules/Report').then((m) => ({ default: m.Report })))
const Integrations = lazy(() => import('./components/modules/Integrations').then((m) => ({ default: m.Integrations })))
const CatchLab = lazy(() => import('./components/modules/CatchLab').then((m) => ({ default: m.CatchLab })))
const Instructions = lazy(() => import('./components/modules/Instructions').then((m) => ({ default: m.Instructions })))
const Leaderboard = lazy(() => import('./components/modules/Leaderboard').then((m) => ({ default: m.Leaderboard })))
const Compensation = lazy(() => import('./components/modules/Compensation').then((m) => ({ default: m.Compensation })))
const Resources = lazy(() => import('./components/modules/Resources').then((m) => ({ default: m.Resources })))
const Meetings = lazy(() => import('./components/modules/Meetings').then((m) => ({ default: m.Meetings })))
const AdminAnalytics = lazy(() => import('./components/modules/AdminAnalytics').then((m) => ({ default: m.AdminAnalytics })))
const DiscoveryResponses = lazy(() => import('./components/modules/DiscoveryResponses').then((m) => ({ default: m.DiscoveryResponses })))
const DiscoveryForms = lazy(() => import('./components/modules/DiscoveryForms').then((m) => ({ default: m.DiscoveryForms })))

function PageFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-card)] border-t-[var(--accent-purple)]" />
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <LanguageProvider>
        <AuthProvider>
          <TimezoneProvider>
          <WorkspaceProvider>
            <ToastProvider>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/landing" element={<Landing forcePublic />} />
                {/* Public, standalone discovery form, no auth, no app layout. */}
                <Route path="/discovery" element={<DiscoveryForm />} />
                <Route path="/discovery/:slug" element={<DiscoveryForm />} />
                <Route
                  path="/login"
                  element={
                    <RedirectIfAuthenticated>
                      <Login />
                    </RedirectIfAuthenticated>
                  }
                />
                <Route
                  path="/signup"
                  element={
                    <RedirectIfAuthenticated>
                      <Signup />
                    </RedirectIfAuthenticated>
                  }
                />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/two-factor" element={<TwoFactor />} />
                <Route path="/verify-email" element={<VerifyEmail />} />
                <Route path="/invite/:token" element={<AcceptInvite />} />
                <Route
                  path="/onboarding"
                  element={
                    <ProtectedRoute>
                      <Onboarding />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <MainLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<Navigate to="analytics" replace />} />
                  <Route
                    path="catch"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <CatchAI />
                      </Suspense>
                    }
                  />
                  <Route
                    path="analytics"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <Analytics />
                      </Suspense>
                    }
                  />
                  <Route
                    path="listening"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <Listening />
                      </Suspense>
                    }
                  />
                  <Route
                    path="moderators"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <Moderators />
                      </Suspense>
                    }
                  />
                  <Route
                    path="kol"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <KOLTracker />
                      </Suspense>
                    }
                  />
                  <Route
                    path="tasks"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <Tasks />
                      </Suspense>
                    }
                  />
                  <Route
                    path="payments"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <Payments />
                      </Suspense>
                    }
                  />
                  <Route
                    path="report"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <Report />
                      </Suspense>
                    }
                  />
                  <Route
                    path="integrations"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <Integrations />
                      </Suspense>
                    }
                  />
                  <Route
                    path="catchlab"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <CatchLab />
                      </Suspense>
                    }
                  />
                  <Route
                    path="instructions"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <Instructions />
                      </Suspense>
                    }
                  />
                  <Route
                    path="leaderboard"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <Leaderboard />
                      </Suspense>
                    }
                  />
                  <Route
                    path="compensation"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <Compensation />
                      </Suspense>
                    }
                  />
                  <Route
                    path="resources"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <Resources />
                      </Suspense>
                    }
                  />
                  <Route
                    path="meetings"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <Meetings />
                      </Suspense>
                    }
                  />
                  <Route
                    path="admin"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <AdminAnalytics />
                      </Suspense>
                    }
                  />
                  <Route
                    path="discovery-responses"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <DiscoveryResponses />
                      </Suspense>
                    }
                  />
                  <Route
                    path="discovery-forms"
                    element={
                      <Suspense fallback={<PageFallback />}>
                        <DiscoveryForms />
                      </Suspense>
                    }
                  />
                  <Route path="profile" element={<Profile />} />
                  <Route path="security" element={<Security />} />
                  <Route path="members" element={<Members />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
            <ConsentBanner />
            <EnvBanner />
            </ToastProvider>
          </WorkspaceProvider>
          </TimezoneProvider>
        </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
