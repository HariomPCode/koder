"use client";

import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import type { AuthResponse } from "@/types/api";
import { ApiError } from "@/lib/api-client";
import { getSafeNextPath, isSuccessfulAuthResponse } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function Login() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const { refreshUser, status } = useAuth();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(getSafeNextPath(window.location.search));
    }
  }, [router, status]);

  const isFormValid = email.trim().length > 0 && password.length > 0;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!isFormValid || loading) {
      return;
    }

    setLoading(true);

    try {
      const result = await api.post<AuthResponse>("/api/v1/auth/signin", {
          email: email.trim(),
          password,
      });

      if (!isSuccessfulAuthResponse(result)) {
        toast.add({
          type: "error",
          description: result.message || "Invalid email or password.",
        });
        return;
      }

      if (!(await refreshUser())) {
        toast.add({
          type: "error",
          description: "Signed in, but your session could not be verified.",
        });
        return;
      }

      toast.add({
        type: "success",
        description: result.message || "Login successful!",
      });

      router.push(getSafeNextPath(window.location.search));
    } catch (error) {
      console.error("Login error:", error);

      toast.add({
        type: "error",
        description:
          error instanceof ApiError
            ? error.message
            : "Unable to connect to the server. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  if (status === "checking" || status === "authenticated") {
    return <main className="flex min-h-screen items-center justify-center"><span className="text-sm text-muted-foreground">Checking session...</span></main>;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="mb-6 text-center">
          <Link
            href="/"
            className="text-2xl font-bold tracking-tight text-gray-900"
          >
            Koder
          </Link>

          <p className="mt-2 text-sm text-gray-500">
            Practice problems. Improve your skills. Become a better coder.
          </p>
        </div>

        <Card className="border-gray-200 shadow-sm">
          <form onSubmit={handleSubmit}>
            <CardHeader className="space-y-1">
              <CardTitle className="text-xl font-semibold">
                Welcome back
              </CardTitle>

              <p className="text-sm text-gray-500">
                Sign in to continue solving problems.
              </p>
            </CardHeader>

            <CardContent>
              <div className="flex flex-col gap-5">
                {/* Email */}
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>

                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoFocus
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                {/* Password */}
                <div className="grid gap-2">
                  <Label htmlFor="password">Password</Label>

                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pr-10"
                    />

                    <button
                      type="button"
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      onClick={() => setShowPassword((previous) => !previous)}
                      className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-3">
              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={loading || !isFormValid}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Logging in...
                  </span>
                ) : (
                  "Login"
                )}
              </Button>

              <div className="relative w-full">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-gray-200" />
                </div>

                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-gray-400">or</span>
                </div>
              </div>

              <Link href="/signup" className="w-full">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  size="lg"
                  disabled={loading}
                >
                  Create an account
                </Button>
              </Link>
            </CardFooter>
          </form>
        </Card>

        <p className="mt-6 text-center text-xs text-gray-400">
          By continuing, you agree to use Koder responsibly.
        </p>
      </div>
    </main>
  );
}
