import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { createAppQueryClient } from "./lib/queryClient";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Goals from "./pages/Goals";
import GoalDetail from "./pages/GoalDetail";
import Timeline from "./pages/Timeline";
import Accounts from "./pages/Accounts";
import Rules from "./pages/Rules";
import Categories from "./pages/Categories";
import Transactions from "./pages/Transactions";
import Scenarios from "./pages/Scenarios";
import SpendingTargets from "./pages/SpendingTargets";
import Reconcile from "./pages/Reconcile";
import Reports from "./pages/Reports";
import Recurring from "./pages/Recurring";
import CreditCards from "./pages/CreditCards";
import Profile from "./pages/Profile";
import PlaidOAuthReturn from "./pages/PlaidOAuthReturn";

const queryClient = createAppQueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { auth } = useAuth();
  if (auth.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }
  if (!auth.access) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/plaid/oauth-return"
        element={
          <ProtectedRoute>
            <PlaidOAuthReturn />
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="timeline" element={<Timeline />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="automation" element={<Rules />} />
        <Route path="rules" element={<Navigate to="/automation" replace />} />
        <Route path="categories" element={<Categories />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="scenarios" element={<Scenarios />} />
        <Route path="spending-goals" element={<SpendingTargets />} />
        <Route path="spending-targets" element={<Navigate to="/spending-goals" replace />} />
        <Route path="budget" element={<Navigate to="/spending-goals" replace />} />
        <Route path="recurring" element={<Recurring />} />
        <Route path="bills" element={<Navigate to="/recurring" replace />} />
        <Route path="credit-cards" element={<CreditCards />} />
        <Route path="goals" element={<Goals />} />
        <Route path="goals/:id" element={<GoalDetail />} />
        <Route path="reconcile" element={<Reconcile />} />
        <Route path="reports" element={<Reports />} />
        <Route path="profile" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
