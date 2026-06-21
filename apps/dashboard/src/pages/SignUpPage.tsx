import { SignUp } from "@clerk/clerk-react";

/** Signup + email verification, owned entirely by Clerk's <SignUp/>. */
export function SignUpPage() {
  return (
    <div className="auth-screen">
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        fallbackRedirectUrl="/app"
      />
    </div>
  );
}
