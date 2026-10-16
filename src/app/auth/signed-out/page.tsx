import { AuthScreen } from "@/components/auth-screen";

export const metadata = { title: "Signed out — Unlabelled Time" };

/** Where signing out ends. Without it, the guard would send the person straight back to the login page. */
export default function SignedOut() {
  return <AuthScreen title="You are signed out" action={{ href: "/auth/login", label: "Sign in" }} />;
}
