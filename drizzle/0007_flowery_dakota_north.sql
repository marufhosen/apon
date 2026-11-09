CREATE TABLE "uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"purpose" text NOT NULL,
	"public_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"delivery_type" text NOT NULL,
	"format" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"secure_url" text NOT NULL,
	"original_name" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uploads_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
ALTER TABLE "host_applications" ADD COLUMN "attachment_upload_id" integer;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "attachment_upload_id" integer;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uploads_owner_idx" ON "uploads" USING btree ("owner_id","purpose");--> statement-breakpoint
CREATE INDEX "uploads_url_idx" ON "uploads" USING btree ("secure_url");--> statement-breakpoint
ALTER TABLE "host_applications" ADD CONSTRAINT "host_applications_attachment_upload_id_uploads_id_fk" FOREIGN KEY ("attachment_upload_id") REFERENCES "public"."uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_attachment_upload_id_uploads_id_fk" FOREIGN KEY ("attachment_upload_id") REFERENCES "public"."uploads"("id") ON DELETE set null ON UPDATE no action;