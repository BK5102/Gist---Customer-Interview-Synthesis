# Client-Side Encrypted Storage Plan

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
2. User enters a private passphrase, or the browser uses a locally stored generated key.
3. Browser creates a random salt.
4. Browser derives an AES-GCM key with PBKDF2 or Argon2id.
5. Browser creates a random IV.
6. Browser encrypts markdown locally with Web Crypto.
7. Browser sends only ciphertext, IV, salt, KDF metadata, and non-sensitive metadata to Supabase/API.

For reading:

1. User opens saved encrypted synthesis.
2. Browser fetches ciphertext.
3. User enters passphrase.
4. Browser derives the same key from salt/KDF settings.
5. Browser decrypts locally and renders markdown.

## UX Choices

Option A: Passphrase per account

- User remembers a passphrase.
- If they forget it, saved encrypted content is unrecoverable.
- Best for trust and simplest to explain.

Option B: Generated browser key

- Browser generates key and stores it locally.
- Easier UX, but content is unavailable on a new device unless the key is exported/imported.
- Developer still cannot read stored ciphertext.

Option C: Account password-derived key

- Avoid this unless Supabase Auth gives a safe way to derive a key without sending or reusing the auth password.
- Never send the encryption passphrase to the backend.

## Product Copy

"Private saved syntheses are encrypted in your browser before storage. Gist stores ciphertext only. If you lose your encryption passphrase, we cannot recover saved encrypted content."

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
3. Add frontend Web Crypto helpers:
   - derive key
   - encrypt markdown
   - decrypt markdown
   - encode/decode base64
4. Add "Save encrypted" UI after synthesis.
5. Add encrypted synthesis list/detail pages.
6. Add delete controls.
7. Add copy explaining unrecoverable passphrases.
