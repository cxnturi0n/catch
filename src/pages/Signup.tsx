import { Navigate } from 'react-router-dom'

// Auth is Google-only: the first "Continue with Google" both creates the account
// and signs the user in, so there is no separate sign-up screen. Keep the /signup
// route working (landing + old links point here) by sending it to the login page.
export function Signup() {
  return <Navigate to="/login" replace />
}
