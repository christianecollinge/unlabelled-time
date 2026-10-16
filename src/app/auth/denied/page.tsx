import { AuthScreen } from "@/components/auth-screen";

export const metadata = { title: "No access — Unlabelled Time" };

/**
 * Shown when the sign-in worked but the account may not use this app, or when
 * the sign-in itself did not complete.
 */
export default async function Denied({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const failed = (await searchParams).reason === "failed";
  return (
    <AuthScreen
      title={failed ? "Sign-in did not complete" : "This account has no access to Unlabelled Time"}
      text={failed ? "Please try again." : "Your account has not been given access to this app. If that is a mistake, get in touch."}
      action={failed ? { href: "/auth/login", label: "Sign in again" } : { href: "/auth/logout", label: "Sign in with another account" }}
    />
  );
}
