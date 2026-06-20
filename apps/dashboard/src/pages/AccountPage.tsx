import { UserProfile, OrganizationProfile } from "@clerk/clerk-react";

/**
 * Account + organization management.
 *
 * - <UserProfile/> covers profile, email, password change, MFA, sessions.
 * - <OrganizationProfile/> covers the *organization* roster: inviting members by
 *   email (Clerk sends the invite + handles accept) and revoking them, with roles.
 *
 * Note: this manages the Clerk Organization. The backend's per-project roster
 * (apps/server `ProjectMember`) is a separate list keyed by Clerk user id — see
 * the MembersTab. Reconciling the two (org invite → project membership) is a
 * backend webhook follow-up; for now org membership and project membership are
 * granted independently.
 */
export function AccountPage() {
  return (
    <div className="account">
      <section>
        <h2>Your account</h2>
        <UserProfile routing="hash" />
      </section>
      <section>
        <h2>Organization</h2>
        <OrganizationProfile routing="hash" />
      </section>
    </div>
  );
}
