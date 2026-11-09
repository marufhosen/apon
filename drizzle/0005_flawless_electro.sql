ALTER TABLE "areas" ADD COLUMN "level" text DEFAULT 'area' NOT NULL;--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "parent_id" integer;--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "ancestor_ids" integer[] DEFAULT '{}'::integer[] NOT NULL;--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_parent_id_areas_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "areas_parent_idx" ON "areas" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "areas_level_idx" ON "areas" USING btree ("level");--> statement-breakpoint
CREATE INDEX "areas_ancestors_idx" ON "areas" USING gin ("ancestor_ids");--> statement-breakpoint
CREATE INDEX "areas_name_en_idx" ON "areas" USING btree (lower("name_en"));