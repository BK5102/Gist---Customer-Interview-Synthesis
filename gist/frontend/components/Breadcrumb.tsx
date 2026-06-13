import Link from "next/link";

type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-5">
      <ol className="flex flex-wrap items-center gap-2 text-sm text-neutral-500">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-2">
            {i > 0 && (
              <span aria-hidden="true" className="select-none text-neutral-400">
                /
              </span>
            )}
            {item.href ? (
              <Link
                href={item.href}
                className="font-medium text-brand-700 transition-colors hover:text-brand-800 hover:underline"
              >
                {item.label}
              </Link>
            ) : (
              <span className="font-semibold text-neutral-800">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
