import { AuthScreen } from "@/components/auth-screen";

export const metadata = { title: "Signed out — Unlabelled Time" };

/**
 * Where signing out ends. Without it, the guard would send the person straight back to the login page.
 * Sign out (/auth/logout) ends Time only; after Sign in with another account (/auth/switch-account)
 * Keycloak comes back with state=switch, and the account itself is signed out.
 */
export default async function SignedOut({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const switched = (await searchParams).state === "switch";
  return switched ? (
    <AuthScreen title="You’re signed out of your Unlabelled account" text="Sign in with the account you want to use." action={{ href: "/auth/login", label: "Sign in" }} />
  ) : (
    <AuthScreen title="You’re signed out of Unlabelled Time" text="Your other Unlabelled tools stay signed in." action={{ href: "/auth/login", label: "Sign in" }} />
  );
}
