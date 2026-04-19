import styles from "./BrandLogoImage.module.css";

type BrandLogoImageProps = {
  /** Header strip vs full-screen splash (same asset, scaled for context) */
  variant?: "header" | "splash";
  className?: string;
};

/**
 * Single source for `/logo-white.svg` — keep Splash and Dashboard visually aligned.
 */
export function BrandLogoImage({
  variant = "header",
  className,
}: BrandLogoImageProps) {
  return (
    <img
      className={[
        styles.logo,
        variant === "splash" ? styles.splash : styles.header,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      src="/logo-white.svg"
      alt="KopiX"
      width={220}
      height={48}
      loading="eager"
      fetchPriority="high"
      decoding="sync"
    />
  );
}
