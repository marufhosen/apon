import type { Metadata } from "next";
import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarCheck,
  CalendarHeart,
  Check,
  Clock,
  EyeOff,
  Flag,
  HeartHandshake,
  Languages,
  MapPin,
  MapPinned,
  MessagesSquare,
  Mic2,
  MonitorSmartphone,
  Plane,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
  UserRoundCheck,
  Vote,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { images } from "@/lib/images";
import { interestIcon } from "@/lib/interest-icons";
import { getInterests } from "@/lib/queries/reference";
import { listActivities } from "@/lib/queries/activities";
import { getDivisionCoverage, getLandingStats } from "@/lib/queries/landing";
import { BLUR_DATA_URL, cn } from "@/lib/utils";
import { Disclosure } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { FadeUp, Stagger, StaggerItem } from "@/components/motion";
import { ActivityCard } from "@/components/features/activities/activity-card";
import { LogoMark } from "@/components/brand/logo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing");
  return {
    title: t("hero.title"),
    description: t("hero.subtitle"),
    openGraph: {
      title: `APON — ${t("hero.title")}`,
      description: t("hero.subtitle"),
      images: [images.hero.src],
    },
  };
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const num = (n: number, locale: string) => {
  const s = n.toLocaleString("en-US");
  return locale === "bn" ? s.replace(/\d/g, (d) => BN_DIGITS[Number(d)]) : s;
};

/** Section heading used throughout the page. */
function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: "center" | "left";
}) {
  return (
    <FadeUp className={cn("max-w-2xl", align === "center" && "mx-auto text-center")}>
      {eyebrow ? (
        <p className="text-primary text-xs font-semibold tracking-[0.14em] uppercase">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-balance sm:text-2xl lg:text-[1.75rem]">
        {title}
      </h2>
      {subtitle ? (
        <p className="text-muted-foreground mt-2 text-sm text-pretty sm:text-[15px]">
          {subtitle}
        </p>
      ) : null}
    </FadeUp>
  );
}

export default async function LandingPage() {
  const [t, locale, interests, stats, divisions, upcoming] = await Promise.all([
    getTranslations("landing"),
    getLocale(),
    getInterests(),
    getLandingStats(),
    getDivisionCoverage(),
    listActivities({ page: 1 }),
  ]);
  const name = (row: { nameEn: string; nameBn: string }) =>
    locale === "bn" ? row.nameBn : row.nameEn;

  const steps = [
    { icon: Sparkles, key: "step1", image: images.howItWorks.share },
    { icon: Users, key: "step2", image: images.howItWorks.match },
    { icon: CalendarHeart, key: "step3", image: images.howItWorks.meet },
  ] as const;

  const week = [
    { icon: Users, key: "day1" },
    { icon: Vote, key: "day2" },
    { icon: CalendarCheck, key: "day3" },
    { icon: HeartHandshake, key: "day4" },
  ] as const;

  const features = [
    { icon: MessagesSquare, key: "chat" },
    { icon: Vote, key: "poll" },
    { icon: Mic2, key: "activities" },
    { icon: UserRoundCheck, key: "women" },
    { icon: Languages, key: "language" },
    { icon: MapPinned, key: "nationwide" },
  ] as const;

  const why = [
    { icon: Plane, key: "card1" },
    { icon: Clock, key: "card2" },
    { icon: MonitorSmartphone, key: "card3" },
  ] as const;

  const safety = [
    { icon: BadgeCheck, key: "point1" },
    { icon: EyeOff, key: "point2" },
    { icon: Flag, key: "point3" },
    { icon: ShieldCheck, key: "point4" },
    { icon: Store, key: "point5" },
    { icon: HeartHandshake, key: "point6" },
  ] as const;

  const statTiles = [
    { icon: Users, label: t("stats.members"), value: stats.members },
    { icon: CalendarCheck, label: t("stats.upcoming"), value: stats.upcoming },
    { icon: HeartHandshake, label: t("stats.circles"), value: stats.circles },
    { icon: MapPin, label: t("stats.places"), value: stats.places },
  ];

  const faqs = [1, 2, 7, 3, 5, 4, 8, 6].map((n) => ({
    question: t(`faq.q${n}` as "faq.q1"),
    answer: t(`faq.a${n}` as "faq.a1"),
  }));

  const preview = upcoming.items.slice(0, 3);

  return (
    <>
      {/* ---------------------------------------------------------------- Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="bg-primary/10 pointer-events-none absolute -top-40 right-[-10%] size-[640px] rounded-full blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-48 left-[-15%] size-[520px] rounded-full bg-amber-300/15 blur-3xl"
        />
        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-8 pb-10 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:pt-12 lg:pb-14">
          <FadeUp>
            <p className="border-primary/20 bg-primary/5 text-primary inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
              <LogoMark className="size-4" />
              {t("hero.badge")}
            </p>
            <h1 className="mt-4 text-[2rem] leading-[1.1] font-semibold tracking-tight text-balance sm:text-[2.6rem] lg:text-[3rem]">
              {t("hero.titleBefore")}
              <span className="text-primary relative whitespace-nowrap">
                {t("hero.highlight")}
                <svg
                  aria-hidden
                  viewBox="0 0 300 12"
                  className="absolute -bottom-2 left-0 h-3 w-full text-amber-400"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M2 9c60-6 160-8 296-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              {t("hero.titleAfter")}
            </h1>
            <p className="text-muted-foreground mt-4 max-w-xl text-[15px] leading-relaxed text-pretty sm:text-base">
              {t("hero.subtitle")}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button size="lg" asChild className="h-11 px-6 text-[15px]">
                <Link href="/sign-up">
                  {t("hero.ctaPrimary")} <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                asChild
                className="h-11 px-5 text-[15px]"
              >
                <Link href="/#how">{t("hero.ctaSecondary")}</Link>
              </Button>
            </div>
            <p className="text-muted-foreground mt-3 text-xs">{t("hero.note")}</p>

            <ul className="border-border mt-6 grid max-w-lg grid-cols-3 gap-3 border-t pt-4 text-sm">
              {[
                { icon: Users, text: t("hero.stat1") },
                { icon: CalendarHeart, text: t("hero.stat2") },
                { icon: MapPin, text: t("hero.stat3") },
              ].map((s) => (
                <li key={s.text} className="text-muted-foreground flex flex-col gap-1.5">
                  <s.icon className="text-primary size-4" aria-hidden />
                  <span className="leading-snug">{s.text}</span>
                </li>
              ))}
            </ul>
          </FadeUp>

          {/* Visual: photo + floating product cards */}
          <FadeUp delay={0.12} className="relative mx-auto w-full max-w-lg lg:max-w-none">
            <div className="border-border from-primary/30 via-primary/10 shadow-primary/10 relative aspect-[4/3] overflow-hidden rounded-3xl border bg-gradient-to-br to-amber-100 shadow-xl">
              <Image
                src={images.hero.src}
                alt={t("hero.imageAlt")}
                fill
                priority
                placeholder="blur"
                blurDataURL={BLUR_DATA_URL}
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
              />
            </div>

            <div className="border-border bg-card/95 absolute top-8 -left-3 w-64 rounded-2xl border p-3 shadow-lg backdrop-blur sm:-left-8">
              <p className="text-success flex items-center gap-1.5 text-xs font-semibold">
                <Check className="size-3.5" aria-hidden /> {t("hero.cardCircle")}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex -space-x-2">
                  {["#0f766e", "#f59e0b", "#0369a1", "#be185d", "#4d7c0f"].map((c) => (
                    <span
                      key={c}
                      className="border-card size-6 rounded-full border-2"
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <span className="text-muted-foreground text-xs">
                  {t("hero.cardCircleText")}
                </span>
              </div>
            </div>

            <div className="border-border bg-card/95 absolute -right-2 bottom-24 w-56 rounded-2xl border p-3 shadow-lg backdrop-blur sm:-right-6">
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                <CalendarCheck className="text-primary size-3.5" aria-hidden />{" "}
                {t("hero.cardMeetup")}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {t("hero.cardMeetupText")}
              </p>
            </div>

            <div className="border-border bg-card/95 absolute -bottom-5 left-6 flex items-center gap-3 rounded-2xl border px-3 py-2.5 shadow-lg backdrop-blur">
              <span className="bg-primary/10 text-primary grid size-8 place-items-center rounded-lg">
                <Vote className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-xs font-semibold">{t("hero.cardPoll")}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="bg-muted h-1.5 w-24 overflow-hidden rounded-full">
                    <span className="bg-primary block h-full w-4/5 rounded-full" />
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    {t("hero.cardPollText")}
                  </span>
                </div>
              </div>
            </div>

            <div className="border-border bg-card absolute -top-4 right-6 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-md">
              <BadgeCheck className="text-primary size-3.5" aria-hidden />{" "}
              {t("hero.cardVerified")}
            </div>
          </FadeUp>
        </div>
      </section>

      {/* -------------------------------------------------------- Live stats */}
      <section aria-label={t("stats.title")} className="border-border bg-card border-y">
        <div className="divide-border mx-auto grid w-full max-w-6xl grid-cols-2 px-4 sm:px-6 lg:grid-cols-4 lg:divide-x">
          {statTiles.map((s) => (
            <div
              key={s.label}
              className="flex items-center gap-3 px-2 py-4 lg:justify-center lg:px-6"
            >
              <span className="bg-primary/10 text-primary grid size-10 place-items-center rounded-xl">
                <s.icon className="size-5" aria-hidden />
              </span>
              <div>
                <p className="tabular text-2xl leading-none font-semibold">
                  {num(s.value, locale)}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="sr-only">{t("stats.note")}</p>
      </section>

      {/* -------------------------------------------------------------- Why */}
      <section className="py-10 sm:py-14">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow={t("why.eyebrow")}
            title={t("why.title")}
            subtitle={t("why.subtitle")}
          />
          <Stagger className="mt-6 grid gap-3 sm:grid-cols-3">
            {why.map((card) => (
              <StaggerItem
                key={card.key}
                className="border-border bg-card rounded-2xl border p-5 shadow-xs"
              >
                <span className="grid size-10 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
                  <card.icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-3 font-semibold">{t(`why.${card.key}Title`)}</h3>
                <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                  {t(`why.${card.key}Text`)}
                </p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ------------------------------------------------------- How it works */}
      <section
        id="how"
        className="border-border bg-card/60 scroll-mt-20 border-t py-10 sm:py-14"
      >
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading title={t("how.title")} subtitle={t("how.subtitle")} />
          <Stagger className="mt-6 grid gap-4 md:grid-cols-3">
            {steps.map((step, i) => (
              <StaggerItem
                key={step.key}
                className="group border-border bg-background overflow-hidden rounded-2xl border shadow-xs"
              >
                <div className="from-primary/25 to-muted relative aspect-[2/1] overflow-hidden bg-gradient-to-br">
                  <Image
                    src={step.image.src}
                    alt={step.image.alt}
                    fill
                    placeholder="blur"
                    blurDataURL={BLUR_DATA_URL}
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                  <span className="bg-primary text-primary-foreground absolute top-3 left-3 grid size-9 place-items-center rounded-full text-sm font-bold shadow">
                    {num(i + 1, locale)}
                  </span>
                  <span className="bg-card/95 absolute right-3 bottom-3 rounded-full px-2.5 py-1 text-[11px] font-medium shadow-sm">
                    {t(`how.${step.key}Time`)}
                  </span>
                </div>
                <div className="p-4">
                  <h3 className="flex items-center gap-2 font-semibold">
                    <step.icon className="text-primary size-4" aria-hidden />
                    {t(`how.${step.key}Title`)}
                  </h3>
                  <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                    {t(`how.${step.key}Text`)}
                  </p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>

          {/* A week in your circle */}
          <div className="border-border bg-background mt-8 rounded-2xl border p-5 shadow-xs sm:p-7">
            <SectionHeading
              title={t("week.title")}
              subtitle={t("week.subtitle")}
              align="left"
            />
            <ol className="relative mt-6 grid gap-5 md:grid-cols-4">
              <span
                aria-hidden
                className="from-primary via-primary/50 absolute top-5 left-5 hidden h-0.5 w-[calc(100%-2.5rem)] bg-gradient-to-r to-amber-400 md:block"
              />
              {week.map((day) => (
                <li key={day.key} className="relative flex gap-4 md:flex-col md:gap-3">
                  <span className="border-primary bg-background text-primary relative grid size-10 shrink-0 place-items-center rounded-full border-2">
                    <day.icon className="size-4" aria-hidden />
                  </span>
                  <div>
                    <p className="text-primary text-[11px] font-semibold tracking-wider uppercase">
                      {t(`week.${day.key}`)}
                    </p>
                    <p className="mt-0.5 font-semibold">{t(`week.${day.key}Title`)}</p>
                    <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                      {t(`week.${day.key}Text`)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- Features */}
      <section className="py-10 sm:py-14">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading title={t("features.title")} subtitle={t("features.subtitle")} />
          <Stagger className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <StaggerItem
                key={f.key}
                className="border-border bg-card hover:border-primary/40 flex gap-4 rounded-2xl border p-5 shadow-xs transition-colors"
              >
                <span className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
                  <f.icon className="size-5" aria-hidden />
                </span>
                <div>
                  <h3 className="font-semibold">{t(`features.${f.key}Title`)}</h3>
                  <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                    {t(`features.${f.key}Text`)}
                  </p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ------------------------------------------- Activities + categories */}
      <section
        id="categories"
        className="border-border bg-card/60 scroll-mt-20 border-t py-10 sm:py-14"
      >
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeading
              title={t("activities.title")}
              subtitle={t("activities.subtitle")}
              align="left"
            />
            <Button asChild variant="outline" className="shrink-0">
              <Link href="/activities">
                {t("activities.browse")} <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>

          {preview.length ? (
            <Stagger className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {preview.map((activity) => (
                <StaggerItem key={activity.id}>
                  <ActivityCard
                    activity={
                      locale === "bn"
                        ? {
                            ...activity,
                            categoryName:
                              activity.categoryNameBn ?? activity.categoryName,
                            areaName: activity.areaNameBn ?? activity.areaName,
                          }
                        : activity
                    }
                    locale={locale}
                  />
                </StaggerItem>
              ))}
            </Stagger>
          ) : (
            <p className="border-border text-muted-foreground mt-6 rounded-2xl border border-dashed p-6 text-center text-sm">
              {t("activities.empty")}
            </p>
          )}

          <div className="mt-10">
            <SectionHeading
              title={t("categories.title")}
              subtitle={t("categories.subtitle")}
            />
            <Stagger className="mt-5 flex flex-wrap justify-center gap-2">
              {interests.map((interest) => {
                const Icon = interestIcon(interest.icon);
                return (
                  <StaggerItem key={interest.id}>
                    <span className="border-border bg-background hover:border-primary/40 hover:bg-accent inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium shadow-xs transition-colors">
                      <Icon className="text-primary size-4" aria-hidden />
                      {name(interest)}
                    </span>
                  </StaggerItem>
                );
              })}
            </Stagger>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- Coverage */}
      <section className="py-10 sm:py-14">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-6 px-4 sm:px-6 lg:grid-cols-[1fr_1.2fr] lg:gap-10">
          <div>
            <SectionHeading
              title={t("coverage.title")}
              subtitle={t("coverage.subtitle")}
              align="left"
            />
            <p className="text-muted-foreground mt-4 flex items-start gap-2 text-sm">
              <Building2 className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
              {t("coverage.footnote", { places: num(stats.places, locale) })}
            </p>
          </div>
          <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {divisions.map((d) => (
              <StaggerItem
                key={d.id}
                className="border-border bg-card rounded-xl border p-3 shadow-xs"
              >
                <MapPin className="text-primary size-4" aria-hidden />
                <p className="mt-2 font-semibold">{name(d)}</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {t("coverage.districts", { count: num(d.districts, locale) })}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t("coverage.upazilas", { count: num(d.upazilas, locale) })}
                </p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ----------------------------------------------------------- Safety */}
      <section
        id="safety"
        className="border-border bg-card/60 scroll-mt-20 border-t py-10 sm:py-14"
      >
        <div className="mx-auto grid w-full max-w-6xl items-start gap-8 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-10">
          <FadeUp className="relative lg:sticky lg:top-24">
            <div className="border-border from-primary/30 to-muted relative aspect-[4/3] overflow-hidden rounded-3xl border bg-gradient-to-br">
              <Image
                src={images.safety.src}
                alt={images.safety.alt}
                fill
                placeholder="blur"
                blurDataURL={BLUR_DATA_URL}
                sizes="(max-width: 1024px) 100vw, 45vw"
                className="object-cover"
              />
              <div className="bg-card/95 absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-2xl p-3 shadow-lg backdrop-blur">
                <ShieldCheck className="text-primary size-8 shrink-0" aria-hidden />
                <p className="text-sm font-medium">{t("safety.text")}</p>
              </div>
            </div>
          </FadeUp>

          <div>
            <SectionHeading title={t("safety.title")} align="left" />
            <Stagger className="mt-5 grid gap-3 sm:grid-cols-2">
              {safety.map((point) => (
                <StaggerItem
                  key={point.key}
                  className="border-border bg-background rounded-xl border p-4 shadow-xs"
                >
                  <point.icon className="text-primary size-5" aria-hidden />
                  <h3 className="mt-2 text-sm font-semibold">
                    {t(`safety.${point.key}Title`)}
                  </h3>
                  <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                    {t(`safety.${point.key}Text`)}
                  </p>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- Host */}
      <section className="py-10 sm:py-14">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <FadeUp className="grid items-center gap-6 overflow-hidden rounded-3xl bg-[#0b3a35] p-6 text-white sm:p-9 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-amber-300 uppercase">
                {t("host.eyebrow")}
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                {t("host.title")}
              </h2>
              <p className="mt-3 max-w-xl text-white/80">{t("host.text")}</p>
              <ul className="mt-4 space-y-2">
                {(["point1", "point2", "point3"] as const).map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-sm text-white/90">
                    <Check
                      className="mt-0.5 size-4 shrink-0 text-amber-300"
                      aria-hidden
                    />
                    {t(`host.${p}`)}
                  </li>
                ))}
              </ul>
              <Button
                asChild
                className="mt-5 bg-amber-400 text-[#0b3a35] hover:bg-amber-300"
              >
                <Link href="/sign-up?next=/host">
                  <Mic2 aria-hidden /> {t("host.cta")}
                </Link>
              </Button>
            </div>
            <div className="relative hidden aspect-[4/3] overflow-hidden rounded-2xl bg-white/10 lg:block">
              <Image
                src={images.howItWorks.meet.src}
                alt={images.howItWorks.meet.alt}
                fill
                placeholder="blur"
                blurDataURL={BLUR_DATA_URL}
                sizes="35vw"
                className="object-cover"
              />
            </div>
          </FadeUp>
        </div>
      </section>

      {/* --------------------------------------------------------------- FAQ */}
      <section
        id="faq"
        className="border-border bg-card/60 scroll-mt-20 border-t py-10 sm:py-14"
      >
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
          <SectionHeading title={t("faq.title")} />
          <FadeUp delay={0.08} className="mt-6">
            {/* Two columns on wide screens keeps the section short. */}
            <div className="grid items-start gap-3 lg:grid-cols-2">
              {[faqs.slice(0, 4), faqs.slice(4)].map((column, i) => (
                <div
                  key={i}
                  className="border-border bg-background rounded-2xl border px-5 shadow-xs [&>*:last-child]:border-b-0"
                >
                  {column.map((faq) => (
                    <Disclosure
                      key={faq.question}
                      question={faq.question}
                      answer={faq.answer}
                    />
                  ))}
                </div>
              ))}
            </div>
            <p className="text-muted-foreground mt-4 text-center text-sm">
              <Link
                href="/guidelines"
                className="text-primary font-medium hover:underline"
              >
                {t("faq.more")}
              </Link>
            </p>
          </FadeUp>
        </div>
      </section>

      {/* --------------------------------------------------------------- CTA */}
      <section className="py-10 sm:py-12">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="border-border bg-primary/10 relative overflow-hidden rounded-3xl border">
            <Image
              src={images.cta.src}
              alt={images.cta.alt}
              fill
              placeholder="blur"
              blurDataURL={BLUR_DATA_URL}
              sizes="100vw"
              className="object-cover"
            />
            <div className="from-background via-background/90 to-background/30 absolute inset-0 bg-gradient-to-r" />
            <div className="relative px-6 py-9 sm:px-10 sm:py-11">
              <FadeUp className="max-w-lg">
                <LogoMark className="size-9" />
                <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                  {t("cta.title")}
                </h2>
                <p className="text-muted-foreground mt-3">{t("cta.text")}</p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button size="lg" asChild className="h-11 px-6">
                    <Link href="/sign-up">
                      {t("cta.button")} <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    asChild
                    className="bg-background/80 h-11"
                  >
                    <Link href="/sign-in">{t("cta.secondary")}</Link>
                  </Button>
                </div>
              </FadeUp>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
