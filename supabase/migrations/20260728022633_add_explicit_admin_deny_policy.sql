-- Make the browser-role denial explicit for both reviewers and automated
-- security checks. service_role bypasses RLS and remains the only granted role.
create policy "Browser roles cannot access administrator allowlist"
on public.admin_users
for all
to anon, authenticated
using (false)
with check (false);
