CREATE TABLE "identity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"email" varchar(255),
	"linked_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "identity_links" ADD CONSTRAINT "identity_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_identity_links_provider_external" ON "identity_links" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "idx_identity_links_user" ON "identity_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_identity_links_email" ON "identity_links" USING btree ("email");