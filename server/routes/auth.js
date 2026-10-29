const { clearSession, serializeClearCookie, serializeSessionCookie, verifyDeviceToken } = require("../auth");
const { parseRequestBody, sendJson, sendJsonWithHeaders, shouldUseSecureCookie } = require("../http_utils");

module.exports = () => [
  {
    method: "GET",
    path: "/api/auth/status",
    auth: "none",
    handler: async (ctx, request, response) => {
      const auth = await ctx.authenticate(request);
      sendJson(response, 200, { authenticated: Boolean(auth), device: auth?.device || null });
    }
  },
  {
    method: "POST",
    path: "/api/auth/login",
    auth: "none",
    handler: async (ctx, request, response) => {
      const body = await parseRequestBody(request);
      const login = await verifyDeviceToken(ctx.authManager, body.token);
      sendJsonWithHeaders(response, 200, { authenticated: true, device: login.device }, {
        "Set-Cookie": serializeSessionCookie(login.sessionCookie, { secure: shouldUseSecureCookie(request) })
      });
    }
  },
  {
    method: "POST",
    path: "/api/auth/logout",
    auth: "none",
    handler: async (ctx, request, response) => {
      await clearSession(ctx.authManager, request.headers.cookie || "");
      sendJsonWithHeaders(response, 200, { authenticated: false }, {
        "Set-Cookie": serializeClearCookie({ secure: shouldUseSecureCookie(request) })
      });
    }
  }
];
