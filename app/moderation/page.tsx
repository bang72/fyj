import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getViewer } from "@/lib/server-foundation";
import ModerationClient from "./moderation-client";

export default async function ModerationPage() {
  const incoming = await headers();
  const host = incoming.get("host") ?? "localhost";
  const protocol = incoming.get("x-forwarded-proto") ?? "https";
  const viewer = await getViewer(new Request(`${protocol}://${host}/moderation`, { headers: incoming }));
  if (!viewer || (viewer.role !== "MODERATOR" && viewer.role !== "ADMIN")) redirect("/");
  return <ModerationClient role={viewer.role} />;
}
