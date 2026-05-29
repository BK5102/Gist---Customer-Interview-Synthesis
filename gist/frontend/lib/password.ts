export const PASSWORD_HINT =
  "Must include uppercase, lowercase, and a special character.";

export const PASSWORD_RULES: { label: string; test: (pw: string) => boolean }[] = [
  { label: "Uppercase letter", test: (pw) => /[A-Z]/.test(pw) },
  { label: "Lowercase letter", test: (pw) => /[a-z]/.test(pw) },
  { label: "Special character", test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

export function validatePassword(pw: string): string | null {
  if (!/[A-Z]/.test(pw))
    return "Password must include at least one uppercase letter.";
  if (!/[a-z]/.test(pw))
    return "Password must include at least one lowercase letter.";
  if (!/[^A-Za-z0-9]/.test(pw))
    return "Password must include at least one special character.";
  return null;
}

export function isValidPassword(pw: string): boolean {
  return validatePassword(pw) === null;
}
