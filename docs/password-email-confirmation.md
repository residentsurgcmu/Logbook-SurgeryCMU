# Password email confirmation rollout

Deploy the frontend before replacing Auth email templates. New links never point to /auth/v1/verify: opening /confirm-password only displays a button. Token hash is kept in the fragment, cleared from history, and exchanged with verifyOtp only on explicit confirmation. Only invite/recovery types are allowed; no arbitrary redirect URL is accepted. Existing links remain supported but cannot be made scanner-resistant retrospectively.

In production Supabase Authentication → Email Templates set Invite user to supabase/templates/invite.html and Reset password to supabase/templates/recovery.html. Subjects: “คำเชิญใช้งาน Resident Corner · Surgery CMU” and “ตั้งรหัสผ่านใหม่ · Resident Corner”. Save old templates first for rollback. Disable email click tracking if configured. These templates are explicitly production-bound; use staging origin for staging. No database migration or account recreation is required.

Verify with a fresh test invitation and recovery email: open page without confirmation (no verify request), then confirm, set password, log in; repeated/expired token rejected. Old emails must be replaced by a newly requested recovery email after cutover. Do not copy tokens, emails, or credentials into public reports.
