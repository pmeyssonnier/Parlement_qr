import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Parlement ouvert — Les réponses à vos questions",
  description: "Explorez les questions et réponses du Parlement bruxellois, avec des sources vérifiables.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
