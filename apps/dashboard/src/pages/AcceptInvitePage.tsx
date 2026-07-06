import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RedirectToSignUp, Show } from "@clerk/react";
import { useApi } from "../api/client.js";

/**
 * Invitation accept landing (`/invite/:token`). Public route:
 *   - signed out → RedirectToSignUp captures this URL, so after sign-up Clerk
 *     returns here to redeem. We send invitees to sign-UP, not sign-in: a person
 *     invited by email almost never has an account yet, and sign-in would just
 *     dead-end on "couldn't find your account". Clerk's sign-up still links to
 *     sign-in for the rare already-registered invitee.
 *   - signed in  → redeem the token and link into the project.
 */
export function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  return (
    <div className="auth-screen">
      <Show when="signed-out">
        <RedirectToSignUp />
      </Show>
      <Show when="signed-in">{token ? <Redeem token={token} /> : <p className="error">Missing invite token.</p>}</Show>
    </div>
  );
}

type Phase =
  | { phase: "working" }
  | { phase: "done"; projectId: string }
  | { phase: "error"; message: string };

function Redeem({ token }: { token: string }) {
  const api = useApi();
  const [state, setState] = useState<Phase>({ phase: "working" });
  const ran = useRef(false);

  useEffect(() => {
    // Guard against React StrictMode's double-invoke: accept is single-use, so a
    // second call would 404 and clobber the success state.
    if (ran.current) return;
    ran.current = true;
    api
      .acceptInvite(token)
      .then((r) => setState({ phase: "done", projectId: r.projectId }))
      .catch((e) => setState({ phase: "error", message: (e as Error).message }));
  }, [api, token]);

  if (state.phase === "working") {
    return <p className="muted">Joining the project…</p>;
  }
  if (state.phase === "error") {
    return (
      <div className="invite-result">
        <h2>Couldn't accept this invitation</h2>
        <p className="error">{state.message}</p>
        <Link className="link" to="/app">
          Go to your projects
        </Link>
      </div>
    );
  }
  return (
    <div className="invite-result">
      <h2>You're in! 🎉</h2>
      <p className="muted">You've joined the project.</p>
      <Link className="link" to={`/app/projects/${state.projectId}`}>
        Open the project <span className="ff-mark" aria-hidden />
      </Link>
    </div>
  );
}
