import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import BrandLockup from "../components/brand/BrandLockup";
import PublicScreen from "../components/legal/PublicScreen";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const notice =
    location.state &&
    typeof location.state === "object" &&
    "message" in location.state &&
    typeof (location.state as { message?: unknown }).message === "string"
      ? (location.state as { message: string }).message
      : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch (err: unknown) {
      setError(err && typeof err === "object" && "message" in err ? String((err as Error).message) : "Login failed");
    }
  }

  return (
    <PublicScreen>
      <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow">
        <BrandLockup />
        {notice ? (
          <p className="text-sm text-green-700 text-center" role="status">
            {notice}
          </p>
        ) : null}
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
            />
          </div>
          <button type="submit" className="w-full py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700">
            Log in
          </button>
        </form>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="text-blue-600 hover:underline">
            Forgot password?
          </Link>
        </p>
        <p className="text-center text-sm text-gray-600">
          No account? <Link to="/register" className="text-blue-600 hover:underline">Sign up</Link>
        </p>
      </div>
    </PublicScreen>
  );
}
