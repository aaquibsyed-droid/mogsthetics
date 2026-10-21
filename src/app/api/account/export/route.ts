import { NextResponse } from "next/server";
import { BRAND } from "@/lib/brand";
import { exportUserData } from "@/lib/repos/account";
import { authed, LIMITS } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";

/** Machine-readable export of everything stored about the user (JSON download). */
export const GET = authed(
  async ({ user }) => {
    const { db } = await getServices();
    const data = await db.withUser(user.id, (q) => exportUserData(q, user.id));
    const body = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        app: BRAND.name,
        account: { id: user.id, email: user.email },
        notes: [
          "Nutrition values are estimates based on the sources recorded in each snapshot's source_metadata.",
          "Meal photos are not included; download them from the app while they are retained.",
        ],
        data,
      },
      null,
      2,
    );
    return new NextResponse(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="nutrilens-export-${new Date().toISOString().slice(0, 10)}.json"`,
        "cache-control": "no-store",
      },
    });
  },
  { rateLimit: LIMITS.export },
);
