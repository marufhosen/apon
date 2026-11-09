import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Inter, Hind_Siliguri } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { UploadsProvider } from "@/components/features/uploads/uploads-context";
import { uploadsEnabled } from "@/lib/env";
import { Toaster } from "sonner";

import { isLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import {
  THEME_COOKIE_NAME,
  THEME_MAX_AGE,
  THEME_STORAGE_KEY,
  isTheme,
} from "@/lib/theme";

import "@/app/globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const hindSiliguri = Hind_Siliguri({
  subsets: ["bengali", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-hind",
  display: "swap",
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common" });
  return {
    title: {
      default: `${t("appName")} — ${t("tagline")}`,
      template: `%s · ${t("appName")}`,
    },
    description:
      "APON matches you into a small weekly circle of people near you, anywhere in Bangladesh, and gives you a reason to meet up in real life.",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: "APON", statusBarStyle: "default" },
    icons: {
      icon: [
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfdfc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1413" },
  ],
  width: "device-width",
  initialScale: 1,
};

/** Migrates the old localStorage preference and handles first-visit system theme. */
const themeScript = `(function(){try{var c=document.cookie.match(/(?:^|; )${THEME_COOKIE_NAME}=([^;]+)/);var s=c?decodeURIComponent(c[1]):localStorage.getItem("${THEME_STORAGE_KEY}");var d=s==="dark"||(!s&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);if(!c&&(s==="light"||s==="dark")){document.cookie="${THEME_COOKIE_NAME}="+s+"; Path=/; Max-Age=${THEME_MAX_AGE}; SameSite=Lax";}}catch(e){}})();`;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const [messages, cookieStore] = await Promise.all([getMessages(), cookies()]);
  const savedTheme = cookieStore.get(THEME_COOKIE_NAME)?.value;
  const theme = isTheme(savedTheme) ? savedTheme : null;

  return (
    <html
      lang={locale}
      className={theme === "dark" ? "dark" : undefined}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={cn(
          "bg-background text-foreground min-h-dvh font-sans antialiased",
          inter.variable,
          hindSiliguri.variable,
          locale === "bn" && "bn-body",
        )}
      >
        <a
          href="#main"
          className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-lg focus:px-4 focus:py-2"
        >
          Skip to content
        </a>
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Dhaka">
          <NuqsAdapter>
            <UploadsProvider enabled={uploadsEnabled}>{children}</UploadsProvider>
          </NuqsAdapter>
          <Toaster
            position="top-center"
            toastOptions={{
              style: { borderRadius: "12px", border: "1px solid var(--border)" },
            }}
            closeButton
            richColors
          />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
