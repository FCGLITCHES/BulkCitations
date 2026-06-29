CREATE TABLE "organization_identity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "organization_identity_links" ADD CONSTRAINT "organization_identity_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_org_identity_links_provider_external" ON "organization_identity_links" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "idx_org_identity_links_org" ON "organization_identity_links" USING btree ("organization_id");