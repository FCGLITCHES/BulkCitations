import { Router } from "express";
import {
  type UserHistoryItem,
  userHistorySnapshotSchema,
} from "@shared/schema";
import { loadUserHistory, saveUserHistory } from "../store/userHistoryStore.js";
import { getAuthenticatedPublicUserFromRequest } from "../utils/userAuth.js";

const router = Router();

function normalizeClientId(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(trimmed) ? trimmed : null;
}

async function resolveOwnerKey(req: Parameters<typeof getAuthenticatedPublicUserFromRequest>[0], clientIdValue: unknown) {
  const account = await getAuthenticatedPublicUserFromRequest(req);
  if (account?.id) {
    return `account:${account.id}`;
  }

  const clientId = normalizeClientId(clientIdValue);
  if (clientId) {
    return `client:${clientId}`;
  }

  return null;
}

function normalizeItems(items: UserHistoryItem[]) {
  return items
    .slice()
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 5000);
}

router.get("/", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  try {
    const ownerKey = await resolveOwnerKey(req, req.query.clientId);
    if (!ownerKey) {
      return res.status(400).json({ message: "clientId is required when no user session is active." });
    }

    const items = await loadUserHistory(ownerKey);
    return res.json({ items });
  } catch (error) {
    console.error("GET /api/history error:", error instanceof Error ? error.message : String(error));
    return res.status(500).json({ message: "Failed to load history." });
  }
});

router.put("/", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  try {
    const data = userHistorySnapshotSchema.parse(req.body);
    const ownerKey = await resolveOwnerKey(req, data.clientId);
    if (!ownerKey) {
      return res.status(400).json({ message: "clientId is required when no user session is active." });
    }

    const items = await saveUserHistory(ownerKey, normalizeItems(data.items));
    return res.json({ items, savedTo: "cloud" });
  } catch (error) {
    console.error("PUT /api/history error:", error instanceof Error ? error.message : String(error));
    return res.status(400).json({
      message: "Failed to save history.",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
