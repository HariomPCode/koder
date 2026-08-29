"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { AlertCircle, CheckCircle2Icon, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function Signup() {
  const [loading, setLoading] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error" | "">("");

  const [showPassword, setShowPassword] = useState(false);

  const backendUri = process.env.NEXT_PUBLIC_BACKEND_URL;

  const isFormValid =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 6;

  const clearMessage = () => {
    if (message) {
      setMessage("");
      setMessageType("");
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!isFormValid || loading) {
      return;
    }

    setLoading(true);
    setMessage("");
    setMessageType("");

    try {
      const res = await fetch(`${backendUri}/api/v1/auth/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim().toLowerCase(),
          password,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        setMessage(result.message || "Unable to create your account.");
        setMessageType("error");
        return;
      }

      setMessage(
        result.message || "Account created successfully. You can now log in.",
      );
      setMessageType("success");
    } catch (error) {
      console.error("Signup error:", error);

      setMessage("Unable to connect to the server. Please try again.");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

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
            Create your account and start solving problems.
          </p>
        </div>

        <Card className="border-gray-200 shadow-sm">
          <form onSubmit={handleSubmit}>
            <CardHeader className="space-y-1">
              <CardTitle className="text-xl font-semibold">
                Create your account
              </CardTitle>

              <p className="text-sm text-gray-500">
                Join Koder and start building your coding skills.
              </p>
            </CardHeader>

            <CardContent>
              <div className="flex flex-col gap-5">
                {/* Name */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="firstName">First name</Label>

                    <Input
                      id="firstName"
                      type="text"
                      placeholder="John"
                      autoComplete="given-name"
                      required
                      value={firstName}
                      onChange={(e) => {
                        setFirstName(e.target.value);
                        clearMessage();
                      }}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="lastName">Last name</Label>

                    <Input
                      id="lastName"
                      type="text"
                      placeholder="Doe"
                      autoComplete="family-name"
                      required
                      value={lastName}
                      onChange={(e) => {
                        setLastName(e.target.value);
                        clearMessage();
                      }}
                    />
                  </div>
                </div>

                {/* Email */}
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>

                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      clearMessage();
                    }}
                  />
                </div>

                {/* Password */}
                <div className="grid gap-2">
                  <Label htmlFor="password">Password</Label>

                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        clearMessage();
                      }}
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

                  <p className="text-xs text-gray-400">
                    Password must be at least 6 characters.
                  </p>
                </div>

                {/* Message */}
                {message && (
                  <Alert
                    variant={
                      messageType === "error" ? "destructive" : "default"
                    }
                  >
                    {messageType === "success" ? (
                      <CheckCircle2Icon className="h-4 w-4" />
                    ) : (
                      <AlertCircle className="h-4 w-4" />
                    )}

                    <AlertTitle>
                      {messageType === "success"
                        ? "Account created"
                        : "Signup failed"}
                    </AlertTitle>

                    <AlertDescription>{message}</AlertDescription>
                  </Alert>
                )}
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
                    Creating account...
                  </span>
                ) : (
                  "Create account"
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

              <Link href="/signin" className="w-full">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  size="lg"
                  disabled={loading}
                >
                  Already have an account? Login
                </Button>
              </Link>
            </CardFooter>
          </form>
        </Card>

        <p className="mt-6 text-center text-xs text-gray-400">
          Start solving problems and track your progress with Koder.
        </p>
      </div>
    </main>
  );
}
