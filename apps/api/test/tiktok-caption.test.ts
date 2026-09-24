import { describe, expect, it } from "vitest";
import { buildTikTokCaption } from "@clips-poster/shared";

describe("buildTikTokCaption", () => {
  it("adds Twitch, channel, and game hashtags to the editable caption", () => {
    expect(buildTikTokCaption("Great round", "TWITCH", "inkmate0", "Counter-Strike 2"))
      .toBe("Great round\n\n#CounterStrike2 #Twitch #inkmate0");
  });

  it("normalizes an existing at sign for Kick", () => {
    expect(buildTikTokCaption("Highlight", "KICK", "@inkmate666"))
      .toBe("Highlight\n\n#gaming #Kick #inkmate666");
  });

  it("keeps attribution when truncating a long title", () => {
    const result = buildTikTokCaption("x".repeat(2_300), "TWITCH", "streamer");
    expect(result).toHaveLength(2_200);
    expect(result.endsWith("\n\n#gaming #Twitch #streamer")).toBe(true);
  });
});
