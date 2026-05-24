import { clerkClient, verifyToken } from "@clerk/express";

const accessDenied = (response) => {
  response.status(403).json({ error: "Access denied" });
};

const getBearerToken = (request) => {
  const authorization = request.get("authorization");

  if (!authorization) {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
};

const getPrimaryEmail = (user) => {
  const primaryEmail = user.emailAddresses.find(
    (emailAddress) => emailAddress.id === user.primaryEmailAddressId
  );

  return (
    primaryEmail?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null
  );
};

export async function clerkAuth(request, response, next) {
  const token = getBearerToken(request);

  if (!token || !process.env.CLERK_SECRET_KEY) {
    console.warn("Clerk auth denied", {
      reason: !token ? "missing_token" : "missing_secret",
      path: request.path,
      origin: request.get("origin") ?? null
    });
    accessDenied(response);
    return;
  }

  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY
    });
    const userId = payload.sub;

    if (!userId) {
      accessDenied(response);
      return;
    }

    const user = await clerkClient.users.getUser(userId);

    if (user.publicMetadata?.approved !== true) {
      console.warn("Clerk auth denied", {
        reason: "user_not_approved",
        path: request.path,
        userId
      });
      accessDenied(response);
      return;
    }

    request.userId = userId;
    request.userEmail = getPrimaryEmail(user);
    request.clerkUser = user;
    next();
  } catch (error) {
    console.warn("Clerk auth denied", {
      reason: "token_verification_failed",
      path: request.path,
      message: error?.message ?? "Unknown Clerk error"
    });
    accessDenied(response);
  }
}
