# Grand Rounds HN production candidate — keep disabled by default

This branch includes the already installed empty foundation and a separate, not-yet-installed interface migration. Do not replay the foundation on the live database. Installing the interface migration alone does not enable the pilot; it seeds no rows, grants no export operator, and the website requires both an explicit build flag and a pinned public-key fingerprint on the known production origin. Keep these build settings unset until an approved pilot. Do not use a real patient ID in rehearsal.

- **Resident:** Case owners with an active Resident profile and role may save/replace exactly seven digits through the dedicated field for an explicitly enrolled case. Leading zeros are preserved. Browser validation handles the plaintext format; the database can validate envelope shape, current key ID and revision, not the encrypted contents. Only the public key and save/revision status are returned. Other users have no HN panel and no read/download API.
- **Operator:** For rehearsal, a database owner can run the private export. Before a real pilot, arrange a named PostgreSQL login approved by the department, grant only USAGE on the HN schema and EXECUTE on the two private functions below to that login, and prove it has no inherited or direct row grants. Do not use a shared owner or disclose credentials through the case UI. The export logs the database session login and case/revision list, never the HN. Save just the returned JSON via the approved internal channel. The operator can review their own export receipts, including while the pilot is paused. A later edit requires a new export; discard obsolete files under the agreed retention procedure.
- **Moderator:** Open the production-format offline HTML locally with the approved encrypted bundle and the corresponding locked private key. No RC login. Keep the opening screen off the projector and shared desktop. The viewer hides the result on case change, tab hide, or after 20 seconds. Keys generated in the rehearsal viewer use a different file format and cannot be loaded into this viewer.
- **Release:** Name the operator, key custodian and recovery custodian; register a fresh public key only after validating it off-device, and complete dual review of the public key fingerprint before setting the separate Vercel pin. Approve explicit case IDs and retention/revocation procedures. Rehearse freeze and recovery, verify the live postconditions while disabled, then seek separate approval to enable a bounded pilot. Use the database switch to pause immediately; this does not revoke earlier exports.
- **Test:** `RC_CHROMIUM=/path/to/chromium python tools/hn-pilot/check_offline.py` uses the actual encryption code, an in-memory PostgreSQL fixture, and the actual offline HTML. No project access, production key or real HN is used. `npm run test:db-grants` replays the full migration set against the existing fixture exclusions.

## Required HN on new Grand Rounds cases

The separate create migration adds the private creator allowlist and an atomic create RPC. It adds no creator and leaves the pilot configuration unchanged. Authorize only the named Resident creators in private pilot_creators after review. The dedicated **เพิ่มเคส Grand Rounds (นำร่อง)** button appears only for invited active Residents; ordinary admissions retain their original form and cannot enter the HN export set through this route. Existing separately enrolled cases still use the original editing flow.

The server reserves a UUID/case code before browser encryption; a reservation alone is not a case. With an encrypted envelope, creation, pilot enrollment, and HN storage commit together. The same in-flight request can be retried without a duplicate. If leaving the page after a lost reply, check the case list before starting a new entry. The operator may remove expired uncommitted reservations using the approved maintenance procedure; do not remove committed ones within the agreed retry window. Disable the pilot through pilot_config to stop reservations, saves, and exports.


### Named PostgreSQL export operator

After applying the export-history migration, an authorized database administrator can grant the named login these permissions (replace the example role with the approved login). The migration itself grants no operator access.

```sql
grant usage on schema rc_hn_prod_private to approved_named_login;
grant execute on function rc_hn_prod_private.export_bundle(uuid[]),
  rc_hn_prod_private.export_history(uuid,integer) to approved_named_login;
```

Connect as the named login directly. `select * from rc_hn_prod_private.export_history();` returns up to 50 of that login’s receipts (operator, time, case UUIDs and corresponding HN revision numbers) with no HN or ciphertext. For older receipts, pass the last returned `export_id` as the first argument and a page size of 1–100 as the second. Do not grant SELECT on either private table. Existing exports remain available to review while new exports are paused.

### Targeted checks for the modal and receipts

Use a synthetic pilot public-key JSON. The database rehearsal uses an in-memory database; the browser check runs Chromium against a local Vite server with all Supabase requests intercepted.

```sh
node tools/hn-pilot/rehearse.mjs /path/to/synthetic-public.json > /tmp/hn-rehearsal-bundle.json
python3 tools/hn-pilot/check_modal_retry.py /path/to/synthetic-public.json
```

The browser check requires Python Playwright and Chromium (use `--chromium /path/to/chromium` for an installed executable). The retry is retained in the open form only; after refresh or navigation, check the case list before entering the case again.
