import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import BrandLockup from "../components/brand/BrandLockup";
import PublicScreen from "../components/legal/PublicScreen";

export default function Register() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checkEmail, setCheckEmail] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await register(username, password, email.trim());
      setCheckEmail(true);
    } catch (err: unknown) {
      setError(err && typeof err === "object" && "message" in err ? String((err as Error).message) : "Registration failed");
    }
  }

  if (checkEmail) {
    return (
      <PublicScreen>
        <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow">
          <BrandLockup size="medium" showTagline={false} />
          <h1 className="text-2xl font-bold text-center">Check your email</h1>
          <p className="text-sm text-gray-700 text-center">
            Check your email to verify your account.
          </p>
          <button
            type="button"
            onClick={() => navigate("/", { replace: true })}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Continue to app
          </button>
        </div>
      </PublicScreen>
    );
  }

  return (
    <PublicScreen>
      <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow">
        <BrandLockup />
        <h1 className="text-xl font-semibold text-center text-gray-900">Sign up</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div>
            <label className="block text-sm font-medium text-gray-700">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
              required
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
              required
              autoComplete="email"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <p className="text-xs text-gray-600">
            By creating an account, you agree to the{" "}
            <Link to="/terms" className="text-blue-700 hover:underline">
              Terms of Service
            </Link>{" "}
            and acknowledge the{" "}
            <Link to="/privacy" className="text-blue-700 hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
          <button type="submit" className="w-full py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700">
            Sign up
          </button>
        </form>
        <p className="text-center text-sm text-gray-600">
          Already have an account? <Link to="/login" className="text-blue-600 hover:underline">Log in</Link>
        </p>
      </div>
    </PublicScreen>
  );
}
