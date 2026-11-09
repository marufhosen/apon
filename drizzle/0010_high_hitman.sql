ALTER TABLE "users" ADD COLUMN "profile_visibility" text DEFAULT 'members' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "show_gender" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "show_age" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "area_visibility" text DEFAULT 'zone' NOT NULL;