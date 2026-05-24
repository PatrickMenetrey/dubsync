export function adminAuth(request, response, next) {
  if (request.clerkUser?.publicMetadata?.role !== "admin") {
    response.status(403).json({ error: "Access denied" });
    return;
  }

  next();
}
