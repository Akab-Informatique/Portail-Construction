import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  /** Mark only (round icon) instead of the full horizontal logo. */
  mark?: boolean;
  /** White lettering, for dark backgrounds. */
  inverted?: boolean;
  alt?: string;
};

/** The one place the FRX Construction logo is rendered. */
export function Logo({ className, mark = false, inverted = false, alt = "FRX Construction" }: LogoProps) {
  const src = mark ? "/brand/logo-icon.png" : inverted ? "/brand/frx-logo-white.png" : "/brand/frx-logo-color.png";
  return (
    <img
      src={src}
      alt={alt}
      className={cn(mark ? "size-8 object-contain" : "h-10 w-auto object-contain object-left", className)}
    />
  );
}
