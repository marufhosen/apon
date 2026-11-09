DROP INDEX "users_phone_idx";--> statement-breakpoint
DROP INDEX "poll_votes_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_unique" ON "users" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "poll_votes_unique" ON "poll_votes" USING btree ("poll_id","user_id","option_id");