"use client";
import { useState } from "react";
import Link from "next/link";
import { DashboardSummary, LocationCard } from "./presentation";
import type { DashboardOrganization } from "@/lib/provider-dashboard/schema";
export function ProviderDashboard({
  organizations,
}: {
  organizations: DashboardOrganization[];
}) {
  const [orgId, setOrgId] = useState(organizations[0]?.id || ""),
    [locationId, setLocationId] = useState("all");
  const org = organizations.find((o) => o.id === orgId) || organizations[0];
  if (!org)
    return (
      <section className="business-panel">
        <h1>Your business workspace</h1>
        <p>
          Approved business claims and accepted team invitations will appear
          here.
        </p>
        <Link className="button secondary" href="/provider/claims">
          View my claims
        </Link>
        <p>
          <Link href="/services">Find your Local Services listing</Link>
        </p>
      </section>
    );
  return (
    <>
      {organizations.length > 1 && (
        <label className="provider-selector">
          Business
          <select
            value={org.id}
            onChange={(e) => {
              setOrgId(e.target.value);
              setLocationId("all");
            }}
          >
            {organizations.map((o) => (
              <option value={o.id} key={o.id}>
                {o.name}
                {o.status !== "active" ? " · Suspended" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <DashboardSummary organization={org} />
      {org.status === "active" && (
        <>
          {org.locations.length > 1 && (
            <label className="provider-selector">
              Location
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="all">All accessible locations</option>
                {org.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="provider-location-grid">
            {org.locations
              .filter((l) => locationId === "all" || l.id === locationId)
              .map((l) => (
                <LocationCard key={l.id} location={l} organization={org} />
              ))}
          </div>
          {org.locations.length === 0 && (
            <section className="business-panel">
              <h2>No active locations available</h2>
              <p>
                Your assigned locations may be suspended or awaiting access.
                Contact your business owner.
              </p>
            </section>
          )}
        </>
      )}
    </>
  );
}
