import { index, layout, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  // Public: centered card, no session needed.
  layout("layouts/auth-layout.tsx", { id: "auth" }, [
    route("signin", "routes/auth/signin.tsx"),
    route("signup", "routes/auth/signup.tsx"),
    route("verify-email", "routes/auth/verify-email.tsx"),
    route("forgot-password", "routes/auth/forgot-password.tsx"),
    route("reset-password", "routes/auth/reset-password.tsx"),
  ]),

  // Signed in. The layout's middleware puts `Me` in context or sends you to /signin.
  layout("layouts/signed-in.tsx", { id: "signed-in" }, [
    index("routes/home.tsx"),
    route("new", "routes/new-org.tsx"),
    route("orgs", "routes/orgs.tsx"),
    route("account", "routes/account.tsx"),

    // One org: the app shell. The layout's middleware puts the OrgOverview in context.
    route(":slug", "layouts/app-shell.tsx", { id: "org" }, [
      index("routes/org/overview.tsx"),
      route("chat", "routes/org/chat.tsx"),
      route("knowledge", "routes/org/knowledge/layout.tsx", { id: "knowledge" }, [
        index("routes/org/knowledge/facts.tsx"),
        route("themes", "routes/org/knowledge/themes.tsx"),
        route("browse", "routes/org/knowledge/browse.tsx"),
        route("activity", "routes/org/knowledge/activity.tsx"),
        route("dont-learn-from", "routes/org/knowledge/dont-learn-from.tsx"),
      ]),
      route("connections", "routes/org/connections.tsx"),
      route("tools", "routes/org/tools.tsx"),
      route("team", "routes/org/team.tsx"),
      route("settings", "layouts/settings-layout.tsx", { id: "settings" }, [
        index("routes/org/settings/index.tsx"),
        route("model", "routes/org/settings/model.tsx"),
        route("slack", "routes/org/settings/slack.tsx"),
        route("google", "routes/org/settings/google.tsx"),
        route("knowledge", "routes/org/settings/knowledge.tsx"),
        route("assistant", "routes/org/settings/assistant.tsx"),
      ]),
    ]),
  ]),

  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
