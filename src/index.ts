import { Context, Schema } from "koishi";
import { escape } from "html-escaper";
import {} from "koishi-plugin-assets-local";

export const name = "dynamic-respondent";
export const inject = {
  required: ["database"],
  optional: ["assets"],
};

export interface Config {
  storeAssets: boolean;
}

export const Config: Schema<Config> = Schema.object({
  storeAssets: Schema.boolean().default(true),
}).i18n({
  "zh-CN": require("./locales/zh-CN")._config,
});

export interface Respondent {
  id: number;
  authorId: number;
  authorName: string;
  match: string;
  escape: boolean;
  content: string;
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function apply(ctx: Context, config: Config) {
  ctx.i18n.define("zh-CN", require("./locales/zh-CN"));

  ctx.model.extend(
    "dyn_respondent",
    {
      id: "unsigned",
      authorId: "unsigned",
      authorName: "string",
      match: "string",
      escape: "boolean",
      content: "text",
    },
    {
      primary: "id",
      autoInc: true,
    }
  );

  // Store matches in memory to avoid database query in every message middleware
  const matchCache = new Set<string>();
  (await ctx.model.get("dyn_respondent", {}, ["match"])).forEach((value) => {
    matchCache.add(value.match);
  });

  const baseCmd = ctx.command("dyn-res");

  baseCmd
    .subcommand(".post <match:string> <content:text>")
    .option("noescape", "-n", { authority: 3 })
    .option("rawassets", "-r", { authority: 3 })
    .action(async ({ session, options }, match, content) => {
      if (!match) return session.text(".pleaseProvideMatch");
      if (!content) return session.text(".pleaseProvideContent");

      const result = await ctx.model.create("dyn_respondent", {
        authorId: (await session.observeUser(["id"])).id,
        authorName: session.username,
        match,
        escape: !options.noescape,
        content:
          options.noescape &&
          !options.rawassets &&
          config.storeAssets &&
          ctx.assets
            ? await ctx.assets.transform(content)
            : content,
      });
      matchCache.add(match);

      return (
        session.text(".success") +
        session.text("commands.dyn-res.messages.details", result)
      );
    });

  baseCmd.subcommand(".show <id:posint>").action(async ({ session }, id) => {
    if (!id) return session.text(".pleaseProvideId");

    const result = (await ctx.model.get("dyn_respondent", id))[0];
    if (!result)
      return session.text("commands.dyn-res.messages.notFound", { id });

    return session.text("commands.dyn-res.messages.details", result);
  });

  baseCmd
    .subcommand(".del <id:posint>")
    .option("force", "-f", { authority: 2 })
    .action(async ({ session, options }, id) => {
      if (!id) return session.text(".pleaseProvideId");

      const result = (
        await ctx.model.get("dyn_respondent", id, ["authorId", "match"])
      )[0];
      if (!result)
        return session.text("commands.dyn-res.messages.notFound", { id });
      if (
        result.authorId !== (await session.observeUser(["id"])).id &&
        !options.force
      )
        return session.text(".forbidden");

      await ctx.model.remove("dyn_respondent", id);
      if (
        !(await ctx.model.get(
          "dyn_respondent",
          {
            match: result.match,
          },
          ["id"]
        ))
      )
        matchCache.delete(result.match);

      return session.text(".success");
    });

  ctx.middleware(async (session, next) => {
    if (!matchCache.has(session.content)) return next();

    const candidates = await ctx.model.get(
      "dyn_respondent",
      {
        match: session.content,
      },
      ["id"]
    );
    const selected = (
      await ctx.model.get("dyn_respondent", randomPick(candidates).id, [
        "id",
        "escape",
        "content",
      ])
    )[0];
    if (selected.escape) selected.content = escape(selected.content);

    return (
      session.text("commands.dyn-res.messages.response", selected) +
      selected.content
    );
  });
}

declare module "koishi" {
  interface Tables {
    dyn_respondent: Respondent;
  }
}
