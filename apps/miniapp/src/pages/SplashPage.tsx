import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { BrandLogoImage } from "@/components/branding/BrandLogoImage";
import styles from "./SplashPage.module.css";

/** ~2s splash before dashboard */
const SPLASH_MS = 2000;

export function SplashPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      navigate("/dashboard", { replace: true });
    }, SPLASH_MS);
    return () => window.clearTimeout(timer);
  }, [navigate]);

  return (
    <main className={styles.root}>
      <div className={styles.vignette} aria-hidden />
      <div className={styles.center}>
        <BrandLogoImage variant="splash" className={styles.logoFade} />
      </div>
    </main>
  );
}
