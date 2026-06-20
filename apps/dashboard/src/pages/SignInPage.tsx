import { SignIn } from "@clerk/clerk-react";

/**
 * Login + "forgot password" + MFA are all handled inside Clerk's <SignIn/>.
 * We render nothing custom — path routing lets Clerk own the /sign-in/* subtree.
 */
export function SignInPage() {
  return (
    <div className="auth-screen">
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/"
      />
    </div>
  );
}
