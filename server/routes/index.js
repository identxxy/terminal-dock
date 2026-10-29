const { sendJson } = require("../http_utils");

// A route is { method, path | match(requestUrl), auth, handler }. `auth` is
// "none" (login endpoints), "session" (device cookie) or "resource" (session
// cookie or a signed preview access token for Browser frame resources).
// Handlers get (context, request, response, requestUrl) and send the response.
function collectRoutes(context) {
  return [
    ...require("./system")(context),
    ...require("./auth")(context),
    ...require("./targets")(context),
    ...require("./stores")(context),
    ...require("./browser")(context),
    ...require("./panes")(context)
  ];
}

function routeMatches(route, request, requestUrl) {
  if (route.method !== request.method) {
    return false;
  }
  return route.path ? route.path === requestUrl.pathname : route.match(requestUrl);
}

function createApiHandler(context) {
  const routes = collectRoutes(context);

  return async function handleApi(request, response, requestUrl) {
    try {
      const route = routes.find((candidate) => routeMatches(candidate, request, requestUrl));
      if (!route) {
        sendJson(response, 404, { error: "API route not found." });
        return;
      }
      if (route.auth !== "none") {
        const resourceAccess = route.auth === "resource" && context.hasPreviewResourceAccess(requestUrl);
        if (!resourceAccess && !(await context.authenticate(request))) {
          sendJson(response, 401, { error: "Authentication required." });
          return;
        }
      }
      await route.handler(context, request, response, requestUrl);
    } catch (error) {
      const statusCode = error.statusCode || (error.message === "Invalid device token." ? 401 : 400);
      sendJson(response, statusCode, {
        error: error.message || "Unexpected error.",
        ...(error.layout ? { layout: error.layout } : {})
      });
    }
  };
}

module.exports = { collectRoutes, createApiHandler };
