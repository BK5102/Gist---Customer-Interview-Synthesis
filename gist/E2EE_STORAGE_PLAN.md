# Client-Side Encrypted Storage Plan

Updated snapshot: 2026-05-22. The app has moved from the earlier local-only IndexedDB key prototype to a password-based private save flow. The user chooses a password for each saved synthesis; encryption and decryption happen in the browser; the password is not saved or sent to Gist.

## Security Requirement

When sensitive customer interview data or derived synthesis output is stored, the developer/operator must not be able to read it.

Server-side encryption is not enough for this requirement if the app developer controls the server and the encryption key. The server could decrypt the data, log it, or change the code. To satisfy the requirement, sensitive stored data must be encrypted in the user's browser before it is sent to Supabase, using a key the server never receives.

## Current Safe Default

Production defaults should be:

```text
STORE_TRANSCRIPTS=false
ENABLE_SYNTH_CACHE=false
STORE_PLAINTEXT_SYNTHESES=false
```

With those settings:

- Raw transcript bodies are processed in memory and not saved to Supabase.
- Quote-bearing cluster/insight cache files are not written for the web app.
- Synthesis markdown is returned to the signed-in user, but not persisted in plaintext.
- Previously saved plaintext transcript/synthesis bodies should be scrubbed with the migrations in `backend/migrations/`.

## Implementation Status

Implemented:

- `frontend/lib/encryption.ts` encrypts/decrypts strings in the browser using Web Crypto.
- The synthesis result section in `frontend/app/page.tsx` requires a save title, a password, and password confirmation before saving privately.
- The password must be at least 12 characters.
- The password is never stored in localStorage, sessionStorage, Supabase, Railway, Vercel, or logs.
- The app inserts only ciphertext, IV, salt, KDF metadata, algorithm metadata, title, project id, artifact type, and ownership metadata into `encrypted_artifacts`.
- `frontend/app/encrypted/page.tsx` lists encrypted saves and decrypts selected saves in the browser when the user enters the correct password.
- `encrypted_artifacts` RLS is tightened so users can manage only their own artifacts and artifacts under projects they own.

Still next:

- Delete encrypted artifact.
- Better UX around forgotten passwords and clear irrecoverability copy.
- Optional per-project password pattern after observing beta feedback.

## What Client-Side Encryption Would Store

Add encrypted columns or a new encrypted artifacts table. The production migration is:

```text
backend/migrations/2026-05-21_encrypted_artifacts.sql
```

Table shape:

```sql
create table encrypted_artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  project_id uuid references projects(id) on delete cascade,
  artifact_type text not null check (artifact_type in ('synthesis', 'transcript')),
  ciphertext text not null,
  iv text not null,
  salt text not null,
  kdf text not null default 'PBKDF2-SHA256',
  iterations int not null default 310000,
  algorithm text not null default 'AES-GCM',
  created_at timestamptz default now()
);
```

RLS:

- Users can select/insert/delete only their own encrypted artifacts.
- The backend should not need the encryption key.
- The service-role key can still read ciphertext, but ciphertext is useless without the user's passphrase.

## Browser Crypto Flow

For saving:

1. User receives synthesis markdown in browser.
2. User enters a save title and password.
3. Browser derives an AES-GCM key from the password using PBKDF2-SHA256 with a random salt.
4. Browser creates a random IV.
5. Browser encrypts markdown locally with Web Crypto.
6. Browser clears password React state after the save attempt.
7. Browser sends only ciphertext, IV, salt, KDF metadata, algorithm metadata, title, project id, artifact type, and ownership metadata to Supabase.

For reading:

1. User opens saved encrypted synthesis.
2. Browser fetches ciphertext.
3. User enters the password used for that save.
4. Browser derives the key from that password and the stored salt.
5. Browser decrypts locally and renders markdown.
6. Browser clears password React state after the restore attempt.

## UX Choices

Chosen current flow: Password per private save

- User chooses a password for each saved synthesis.
- The password is not stored and is not sent to the backend.
- The stored artifact is portable across browsers/devices if the user remembers the password.
- If the user forgets the password, Gist cannot recover the saved report.
- This is simpler to trust than storing the key and lock together.

Rejected previous Phase 1: Browser-generated local key

- It was easier UX, but clearing browser storage or switching devices could permanently lock the user out.
- It also made users ask why they could still open saves without entering a secret.

Option A: Passphrase per account/project

- Could reduce repeated password prompts.
- Needs careful UX and migration logic.
- Consider only after observing beta usage.

Option B: Generated browser key

- Browser generates key and stores it locally.
- Easier UX, but content is unavailable on a new device unless the key is exported/imported.
- Developer still cannot read stored ciphertext.

Option C: Account password-derived key

- Avoid this unless Supabase Auth gives a safe way to derive a key without sending or reusing the auth password.
- Never send the encryption passphrase to the backend.

## Product Copy

"Private saved syntheses are encrypted in your browser with a password you choose. Gist stores ciphertext only and never stores or receives your password. If you forget the password for a private save, Gist cannot recover it."

## Limitations To State Honestly

- During synthesis, the backend still receives transcript/audio data so it can call transcription and LLM providers.
- Anthropic receives transcript-derived text for synthesis.
- Groq or OpenAI may receive audio/video for transcription.
- Client-side encryption protects stored data after processing; it does not make the whole processing pipeline end-to-end encrypted.
- A fully zero-knowledge version would require local/browser-side transcription and synthesis or user-owned model/provider infrastructure.

## Implementation Steps

1. Keep plaintext persistence disabled:
   - `STORE_TRANSCRIPTS=false`
   - `ENABLE_SYNTH_CACHE=false`
   - `STORE_PLAINTEXT_SYNTHESES=false`
2. Add `encrypted_artifacts` table and RLS.
3. Add frontend Web Crypto helpers: (done)
   - derive key
   - encrypt markdown
   - decrypt markdown
   - encode/decode base64
4. Add "Save privately" UI after synthesis. (done)
5. Add encrypted synthesis list/detail page. (done)
6. Add delete controls.
7. Add event logging for save/open/decrypt failure.
