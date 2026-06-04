"use client";

import { useFormStatus } from "react-dom";

function LogoutSubmit() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="btn-ghost min-w-[5.25rem]"
      disabled={pending}
      aria-live="polite"
    >
      {pending ? "Logging out..." : "Log out"}
    </button>
  );
}

export function LogoutButton() {
  return (
    <form action="/logout" method="post" className="ml-1">
      <LogoutSubmit />
    </form>
  );
}
