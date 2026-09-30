import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Parlement ouvert — Les réponses à vos questions",
  description: "Explorez les questions et réponses du Parlement bruxellois, avec des sources vérifiables.",
  icons: { icon: "/favicon.svg" },
};

// Sets <html data-theme> before the first paint, from the saved choice
// (components/theme-toggle.tsx) or else the system preference: no flash of
// the wrong theme. Inline scripts are allowed by the CSP (next.config.ts).
const themeScript = `(function(){var t;try{t=localStorage.getItem("pq-theme")}catch(e){}
if(t!=="light"&&t!=="dark")t=window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";
document.documentElement.dataset.theme=t})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // data-theme is set by the script before hydration.
    <html lang="fr" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant script, no user data */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
