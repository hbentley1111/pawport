# Verified health records — operator handoff

Branch: `feature/verified-records`. This change is not deployed automatically.

## What changed

- `/records` adds a private document library, vaccination-to-document association, trust labels, and explicit requests to a clinic. Existing vaccination entry still inserts the same fields into the same table.
- `/provider` is a narrow queue for administrator-approved clinic members. It discloses only the submitted vaccination, pet name/species, and its attached document while the request is pending. Providers do not gain SELECT access to pets, households, or vaccination history.
- Owner dashboard and public share views show **Owner entered**, **Document supported**, or **Vet verified**, with clinic attribution and verification date. Clinic text entered by an owner remains separate from the authenticated verifying organization.
- Owners may cancel pending requests. An active member of the verifying clinic may revoke a completed verification. Revocation removes the verified label on subsequent reads, including previously generated share URLs. Evidence files and original vaccination data are immutable to users.
- Uploaded files are downloaded via an authenticated, uncached application route. No public or signed document URL is emitted by the application.

## Migration and deployment order

1. Back up the database and test the migration on a separate Supabase staging project containing representative pre-existing pets, vaccinations, and share passes.
2. Apply **only** `supabase/migrations/202609110002_verified_records.sql` to an existing installation. A fresh project needs `202609110001_passport.sql` first. The production migration has not been edited.
3. Run the tests described below against staging and follow the manual acceptance flow.
4. Review and merge the feature branch when ready, then deploy the app through your existing Vercel workflow. This implementation does not push, merge, migrate a remote database, or deploy.

The new migration is transactional. It creates the following tables with RLS and read-only grants to authenticated users; changes occur only through restricted RPCs/triggers:

| Table                    | Purpose                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `veterinary_providers`   | Administrator-vetted clinic directory                                                                           |
| `provider_memberships`   | Administrator-managed authenticated clinic identities                                                           |
| `health_documents`       | Pet association, owner, filename, object path, MIME, size, upload completion                                    |
| `vaccination_documents`  | Immutable association of one evidence document to a vaccination                                                 |
| `vaccination_provenance` | Original owner-entry provenance; historical actors are unknown                                                  |
| `verification_requests`  | Request, clinic, status, immutable verifier UUID, timestamp, clinic-name snapshot, private notes and revocation |
| `health_audit_events`    | Append-only actor-attributed health-record events                                                               |

Historical vaccinations are backfilled with `owner_entered` provenance using their original creation timestamp and a null actor; they are never inferred to be verified. No historical data is removed or rewritten.

`read_share_pass(text)` is replaced in this **new** migration to add four explicitly public vaccination fields: `source`, `verification_status`, `verified_by` (clinic name), and `verified_at`. Its signature, existing fields, grants, token hashing, expiration and revocation checks are preserved. Document identifiers/paths, verification notes, verifier user IDs, and owner identity are excluded. Existing share creation and revocation functions are untouched. There was no share audit table in the original MVP; this change does not claim or introduce one.

## Storage configuration

The migration creates the `health-documents` bucket:

- **Private**, never public.
- Per-file maximum **3,145,728 bytes (3 MiB)**, below Vercel's request-body ceiling with multipart overhead.
- MIME allowlist: `application/pdf`, `image/jpeg`, `image/png`.
- Supported extensions: `.pdf`, `.jpg`, `.jpeg`, `.png`, case-insensitive.
- Database-reserved object paths; owner uploads expire one hour after reservation. Upserts, updates, and user deletion are denied. Maximum 100 document reservations per pet.
- Restrictive Storage policies guard this bucket even if unrelated permissive policies already exist. They do not change access to other buckets.

Check Supabase's **global Storage file-size setting** permits at least 3 MiB. Do not add a public SELECT policy or flip the bucket to public. If a bucket called `health-documents` already exists, inspect it before applying the migration: the deliberate unique-name failure prevents silently adopting an unsafe bucket.

No other Auth setting changes are required. Continue using email confirmation and existing password security settings. There are **no new application environment variables** or runtime service-role credentials.

[Supabase bucket restrictions](https://supabase.com/docs/guides/storage/buckets/fundamentals) and [Storage RLS](https://supabase.com/docs/guides/storage/security/access-control) describe the underlying access model.

## Onboard a provider manually

Provider registration is intentionally not self-service. Verify the clinic and its authorized representative outside the app before granting membership. A `Vet verified` label means an authenticated member of this approved organization explicitly attested to the record; it is not automatic document certification or licensure verification by software.

1. Have the veterinary representative sign up and confirm their email normally. They do not need a household or pet. Existing signup may show onboarding; after provisioning membership they can open `/provider` directly. Subsequent sign-in takes a provider without a household to the provider workspace.
2. In the Supabase SQL editor, look up their exact Auth user UUID:

   ```sql
   select id, email from auth.users where email = 'verified-vet@example.com';
   ```

3. Create the vetted organization and record its returned UUID:

   ```sql
   insert into public.veterinary_providers (name)
   values ('South End Veterinary Clinic')
   returning id;
   ```

4. Grant membership using those UUIDs (replace placeholders):

   ```sql
   insert into public.provider_memberships (provider_id, user_id)
   values ('CLINIC_UUID', 'AUTH_USER_UUID');
   ```

5. To withdraw future provider access:

   ```sql
   update public.provider_memberships set active = false
   where provider_id = 'CLINIC_UUID' and user_id = 'AUTH_USER_UUID';
   ```

Membership/clinic deactivation stops subsequent provider operations. Previously completed verifications remain historical attestations; revoke individual attestations before deactivating the last clinic member if they are no longer valid. The clinic name and verifier UUID are retained as verification history, even if the Auth account is later removed. Owner accounts cannot self-verify even when they hold approved membership.

## Exact manual acceptance flow

Use three separate browser profiles: **Owner A**, **Owner B**, and **Vet**. Use a fourth signed-out/incognito browser for share and document checks.

1. Before applying the new migration to staging, create Owner A's pet, an owner-entered Rabies vaccination, and a share pass. Save that URL.
2. Apply the additive migration and deploy the feature code to a staging/preview environment pointed at staging Supabase. Confirm the old dashboard, vaccination and old share URL still load; Rabies shows **Owner entered**.
3. Add another vaccination through the existing Add vaccination control. Confirm it appears in both Overview and Health Records with **Owner entered**.
4. In Health Records upload a PDF. Repeat with JPG/JPEG and PNG. Try an unsupported extension, a mismatched extension/MIME, an empty file, and a file larger than 3 MiB; they must be rejected.
5. Download the completed document as Owner A. Copy the `/documents/UUID` application URL and open it as Owner B and signed out: both must get **Document unavailable**. Confirm the bucket is private in Supabase.
6. Attach the PDF to Rabies. Confirm **Document supported** appears on Overview, Health Records and the old public share URL. It must not say Vet verified. No source-document link should exist on the public passport.
7. Provision Vet membership as above. As Owner A choose that clinic, review the sharing disclosure, check consent and request verification. An owner deliberately presents the **entire attached document**, which may contain more than the one vaccination. Remove unrelated private information before uploading.
8. As Vet open `/provider`. Confirm only the submitted Rabies record and pet name/species appear, with the attached document. Other vaccinations and unattached documents must be inaccessible. Download the document and compare details with the clinic's evidence.
9. As Owner B, visit `/provider`; no provider queue should be accessible. Through an authenticated API client, attempts to INSERT membership/verification rows or call `complete_vaccination_verification` must fail. As Owner A, even if temporarily given clinic membership by an administrator, self-verification must fail.
10. As Vet, enter optional notes, check the attestation and click Verify record. Confirm Owner A sees **Vet verified**, the clinic name and verification date on Overview and Health Records. Reload the _old_ share link: it must show the same trust attribution without notes, document data, or the individual verifier UUID.
11. As Vet, the completed request's document access is now withdrawn. Click Revoke verification. Refresh Owner A's passport and old share link: the label returns to **Document supported**, with no current verified attribution.
12. As Owner A request verification again, then cancel it while pending. The Vet queue and attached-document access must disappear on subsequent requests. The record remains Document supported.
13. Generate another time-limited share pass and open it anonymously. Revoke it using the existing dashboard control; the old URL must become unavailable. Check an expired share pass as well.
14. Inspect `health_audit_events` in the SQL editor. Confirm events for new vaccination creation, upload finalization, document download access, document association, verification request, completion, revocation and cancellation, with the expected actor IDs. Historical vaccinations do not get fabricated creation events.
15. Repeat the key owner and provider steps at mobile width, using keyboard navigation. Confirm error/success feedback and downloads work in the deployment's browser and hosting environment.

## Tests

Run the required checks:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

`tests/verified-database.test.ts` executes the original and additive SQL migrations in PGlite's PostgreSQL engine with pgcrypto. Minimal `auth` and `storage` schema fixtures model Supabase's authorization contracts. It tests migration compatibility, actual RLS, RPC authorization, uploads/attachments, self-verification, narrow provider scope, verification attribution, revocation, cancellation and old share links. It does not exercise Supabase's Storage HTTP service, JWT verification, concurrent transactions or Vercel routing.

Two hosted suites run when all the following **test-only** variables are supplied against a dedicated Supabase project with both migrations installed:

```sh
TEST_SUPABASE_URL=... \
TEST_SUPABASE_PUBLISHABLE_KEY=... \
TEST_SUPABASE_SERVICE_ROLE_KEY=... npm test
```

`tests/rls.test.ts` preserves the original hosted isolation/share regression suite. `tests/verified-supabase.test.ts` adds real Storage upload/download denials, owner document association, administrator-provisioned membership, authorized verification and anonymous trust display. They create disposable accounts and clean their resources. Do not run these suites against production or put their service key in any application environment variable. Without test credentials they report **SKIP**, not a passing hosted integration check.

## Security findings and known limits

- All new public tables have RLS. Authenticated users get SELECT only; security-definer functions use an empty search path, explicit caller ownership/membership checks, and restricted execution grants. Provider authorization never comes from editable user metadata or owner-typed clinic names.
- Original vaccinations remain immutable to owners. Attachment and request creation lock the vaccination row; requests have a partial unique index permitting one pending or verified request per vaccination. Verification/cancellation/revocation lock the request row. Replayed or stale completions fail.
- Files remain private. The upload route checks session, same-origin POST, bounded request size, filename/extension, MIME and file signature. The bucket independently enforces size/MIME and Storage RLS enforces ownership. Direct owner Storage API calls can bypass application signature sniffing, but cannot bypass ownership, bucket restrictions or the requirement for separate provider attestation. The authenticated download route checks signatures again and forces attachment downloads with `nosniff`, sandbox CSP and no-store headers.
- Signature checks are **not malware scanning** or proof a document is genuine. Downloads should be opened with updated document software. No OCR, extraction, diagnosis or medical recommendation is performed.
- Owners/providers authorized to read a document can retain or redistribute its downloaded contents. Authorized Storage clients could also issue their own signed URL; the application does not issue one. No authorization system can retract a previously downloaded copy. Revocation stops subsequent app/Storage reads; an already-started response may complete.
- `document_accessed` records an authorized download delivery attempt through the app, not proof someone read the document. Direct Supabase Storage API reads are not captured by this application audit table. Authorized users can invoke their own access-log RPC, so access events are not forensic proof of a view. Other audit events are generated transactionally by the relevant database mutation and cannot be directly inserted/updated/deleted by app users.
- Documents are one-per-vaccination attachments in this narrow version. There is no replacement/deletion UI. Wrong evidence or corrections need an operator process; do not silently edit attested vaccination data. A revoked request preserves its history.
- PostgreSQL and object storage are not a single transaction. An interrupted upload can leave a reservation or stored-but-unfinalized object. The library offers **Finish upload** for the latter. Stale reservations count against the 100-document limit. Operators should inspect and remove only unattached/unrequested stale files through the Storage API before removing their document rows; never delete Storage metadata directly.
- Audit identity UUIDs are retained after Auth account deletion. Account deletion/retention policy should account for this deliberate provenance retention. No bulk retention jobs are added here.

## Migration/deployment risks and next step

Apply the migration **before** deploying feature code; the new records screens and dashboard trust query require its RPCs. The previous app build remains compatible with the additive schema, so an app rollback does not require deleting any new tables. Do not roll back by dropping evidence or audit data.

The provenance backfill and trigger creation briefly lock/write existing vaccination data. Schedule the migration appropriately for your row count and back it up first. Confirm pgcrypto is in the existing `extensions` schema, as already required by the production migration. A pre-existing same-name bucket causes a safe migration failure and requires inspection.

The recommended next step is a separate Supabase staging project plus Vercel preview, manual vet identity provisioning, the hosted integration suites, and the exact acceptance flow above. Only after that review should you merge and deploy to production.
