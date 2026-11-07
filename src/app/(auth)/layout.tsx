import { BrandMark, BrandWordmark } from "@/components/layout/brand-mark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center justify-center gap-2.5">
          <BrandMark className="size-9" />
          <BrandWordmark className="text-xl" />
        </div>
        {children}
      </div>
    </main>
  );
}
