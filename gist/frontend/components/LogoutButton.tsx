"use client";

import { useFormStatus } from "react-dom";

function LogoutSubmit() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="nav-link"
      disabled={pending}
      aria-live="polite"
      aria-label={pending ? "Logging out" : "Log out"}
    >
      <svg
        className="h-5 w-5 sm:hidden"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path
          d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4m5-3 4-4-4-4m4 4H9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="hidden sm:inline">
        {pending ? "Logging out..." : "Log out"}
      </span>
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
