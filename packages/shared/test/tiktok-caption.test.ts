import { describe, expect, it } from "vitest";
import { buildTikTokCaption } from "../src/index.js";

describe("buildTikTokCaption", () => {
  it("includes the highlight title, game, platform, and source channel", () => {
    expect(buildTikTokCaption("Клатч 1v3", "TWITCH", "@inkmate0", "Counter-Strike 2"))
      .toBe("Клатч 1v3\n\n#CounterStrike2 #Twitch #inkmate0");
  });

  it("uses a generic game tag when the source has no category", () => {
    expect(buildTikTokCaption("IRL moment", "KICK", "inkmate666", null))
      .toBe("IRL moment\n\n#gaming #Kick #inkmate666");
  });

  it("keeps the caption inside TikTok's title limit", () => {
    const caption = buildTikTokCaption("x".repeat(3_000), "KICK", "streamer", "Just Chatting");
    expect(caption.length).toBeLessThanOrEqual(2_200);
    expect(caption.endsWith("\n\n#JustChatting #Kick #streamer")).toBe(true);
  });
});
